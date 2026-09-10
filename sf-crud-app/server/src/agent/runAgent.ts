// The agent reasoning loop.
//
// Takes a user chat message, sends it to Claude together with the tool
// definitions from `tools.ts`, and runs a manual tool-use loop: Claude
// decides which backend operation(s) to call and with what arguments, we
// execute them in-process against Salesforce, feed the results back, and
// repeat until Claude produces a final text answer.
//
// Destructive tools (update / delete, single or bulk) are gated: when
// Claude asks for one, the loop stops BEFORE executing, stashes the
// transcript on the session, and returns a preview asking the user to
// confirm. The next request ("yes" / "no") resumes or discards it.

import Anthropic from "@anthropic-ai/sdk";
import type { Session, SessionData } from "express-session";
import { env } from "../config/env.js";
import type { SalesforceSession } from "../auth/session.js";
import { executeTool } from "./executeTool.js";
import { AGENT_TOOLS, DESTRUCTIVE_TOOLS } from "./tools.js";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;

// Hard cap on Claude<->tool round trips per message, so a confused model
// can't loop forever (and run up cost) on a single request. Bulk requests
// still resolve in a few turns because update_records / delete_records act
// on up to 200 records at once.
const MAX_ITERATIONS = 20;

// A stashed pending action older than this is treated as abandoned.
const PENDING_TTL_MS = 15 * 60 * 1000;

// If this many turns in a row have every tool call fail, stop looping and
// report back instead of burning the whole iteration budget on retries.
const MAX_CONSECUTIVE_ERROR_TURNS = 3;

const SYSTEM_PROMPT = `You are the Salesforce Ops Agent for a CRUD app. A user types a plain-English request and you carry it out by calling the provided tools against their Salesforce org.

You can work with five objects: Account, Opportunity, Lead, Contact, and Case.

Work in a search -> decide -> act loop:
1. SEARCH: call search_records with filters so Salesforce does the filtering. For date/time comparisons pass SOQL literals with value_is_literal: true (e.g. LAST_N_DAYS:90, TODAY, 2026-01-01). For "newest"/"latest"/"largest"/"top" requests, pass order_by (e.g. { field: "CreatedDate", direction: "DESC" }) with a limit. Request the Id plus any fields you need to reason about (e.g. LastActivityDate, Amount, StageName).
2. DECIDE: from the returned records, work out which Ids actually match the user's intent. If nothing matches, say so.
3. ACT: for one record use update_record / delete_record. For several, collect their Ids and make ONE update_records / delete_records call (up to 200 Ids) rather than many single calls.

Other guidelines:
- Never guess an Id - always get it from a search_records result first.
- Request only the fields you need. Case has no Name field - use fields like CaseNumber, Subject, Status, Priority.
- If a request is ambiguous, ask ONE short clarifying question instead of guessing. Ambiguous means: the object or record isn't clear ("update the Acme record" - which object?), the new value isn't given ("bump the amount" - to what?), "close"/"archive"/"done" could map to more than one field or stage, or a name matches several records. Never invent a field value the user didn't supply.
- If a search returns no records, say plainly that nothing matched and stop - don't loosen the filters unless the user asked you to.
- The app pauses and asks the user to confirm before any update or delete actually runs, so you don't need to ask for confirmation yourself - just call the tool. Before calling a destructive tool, write a short line naming the records you're about to change.
- When a tool returns an { error }, read it. Fix the arguments and retry ONCE if the fix is obvious (a wrong field name, a missing quote); otherwise explain the problem to the user in plain language and stop. Don't retry the same call unchanged.

Format your final answer for a chat window, not a terminal:
- Open with a one-line summary of the outcome, e.g. "Found 12 opportunities matching your filter." or "Closed all 12."
- If you're reporting more than about three records, list them as a short Markdown bullet list ("- Acme renewal — $40k — Stage: Negotiation"), not a table and not raw JSON.
- Never paste raw JSON, SOQL, or Salesforce Ids as the main content. Mention an Id only if the user asked for it.
- Always state counts ("3 of 5 updated") and call out anything that failed and why.
- Keep it brief — a sentence or two plus the list. Use **bold** only for the headline numbers.`;

export interface AgentReply {
  reply: string;
  awaitingConfirmation?: boolean;
  // Set when the Salesforce session died mid-request — the client should
  // prompt the user to log in again.
  sessionExpired?: boolean;
}

type ChatSession = Session & Partial<SessionData>;

// Thrown from deep in the loop to end the whole request with a specific
// user-facing reply (Anthropic API down, Salesforce session expired, too
// many consecutive tool errors). Caught once in runAgent.
class AgentAbort extends Error {
  constructor(public readonly reply: AgentReply) {
    super(reply.reply);
    this.name = "AgentAbort";
  }
}

function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The agent's Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the server.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "The Anthropic API key doesn't have access to the model this agent uses.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "The agent is being rate-limited by the Anthropic API right now. Wait a moment and try again.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "The Anthropic API is having trouble right now. Please try again in a bit.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "The agent couldn't reach the Anthropic API. Check the server's network connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `The Anthropic API returned an error (${error.status ?? "unknown"}). Please try again.`;
  }
  console.error("Unexpected error calling Claude:", error);
  return "The agent hit an unexpected error while talking to Claude.";
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!env.anthropicApiKey) return null;
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: env.anthropicApiKey });
  }
  return cachedClient;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

const AFFIRMATIVE = new Set([
  "y", "yes", "yeah", "yep", "yup", "ok", "okay", "confirm", "confirmed",
  "proceed", "go", "go ahead", "do it", "approved", "approve", "sure",
]);
const NEGATIVE = new Set([
  "n", "no", "nope", "nah", "cancel", "stop", "abort", "don't", "dont",
  "do not", "never mind", "nevermind",
]);

function classifyConfirmation(message: string): "yes" | "no" | "unclear" {
  const normalized = message.trim().toLowerCase().replace(/[.!]+$/, "");
  if (AFFIRMATIVE.has(normalized)) return "yes";
  if (NEGATIVE.has(normalized)) return "no";
  return "unclear";
}

function renderFieldChanges(fields: unknown): string {
  if (typeof fields !== "object" || fields === null) return "(no fields)";
  return Object.entries(fields as Record<string, unknown>)
    .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
    .join(", ");
}

function summarizeIds(ids: unknown): string {
  if (!Array.isArray(ids)) return "";
  const shown = ids.slice(0, 10).join(", ");
  return ids.length > 10 ? `${shown}, +${ids.length - 10} more` : shown;
}

// A deterministic, honest preview of exactly what the pending tool calls
// will do — built from the tool inputs, not from anything the model says.
function describePendingActions(blocks: Anthropic.ToolUseBlock[]): string {
  const lines = blocks.map((block) => {
    const input = (block.input ?? {}) as Record<string, unknown>;
    const object = String(input.object ?? "record");
    switch (block.name) {
      case "delete_record":
        return `- Delete 1 ${object} (${String(input.id)}).`;
      case "update_record":
        return `- Update ${object} ${String(input.id)}: set ${renderFieldChanges(input.fields)}.`;
      case "delete_records":
        return `- Delete ${Array.isArray(input.ids) ? input.ids.length : "?"} ${object} records: ${summarizeIds(input.ids)}.`;
      case "update_records":
        return `- Update ${Array.isArray(input.ids) ? input.ids.length : "?"} ${object} records (${summarizeIds(input.ids)}): set ${renderFieldChanges(input.fields)}.`;
      default:
        return `- ${block.name}`;
    }
  });
  return `This will change your Salesforce data:\n${lines.join("\n")}`;
}

function isToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

async function createMessage(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  try {
    return await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });
  } catch (error) {
    throw new AgentAbort({ reply: describeAnthropicError(error) });
  }
}

// A Salesforce 401 / INVALID_SESSION_ID means the OAuth token died after
// requireAuth let the request through (the agent loop can run for a while).
function isSalesforceAuthError(result: Record<string, unknown>): boolean {
  if (result.status === 401) return true;
  const details = result.details;
  return (
    Array.isArray(details) &&
    details.some(
      (detail) =>
        detail !== null &&
        typeof detail === "object" &&
        (detail as { errorCode?: string }).errorCode === "INVALID_SESSION_ID",
    )
  );
}

interface ToolTurnOutcome {
  results: Anthropic.ToolResultBlockParam[];
  errorCount: number;
  lastError: string | null;
}

async function executeToolUses(
  blocks: Anthropic.ToolUseBlock[],
  sf: SalesforceSession,
  options: { declined?: boolean } = {},
): Promise<ToolTurnOutcome> {
  const results: Anthropic.ToolResultBlockParam[] = [];
  let errorCount = 0;
  let lastError: string | null = null;

  for (const block of blocks) {
    if (options.declined) {
      results.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: "The user declined this action. It was not performed.",
        is_error: true,
      });
      continue;
    }

    const result = await executeTool(
      block.name,
      (block.input ?? {}) as Record<string, unknown>,
      sf,
    );

    if (isSalesforceAuthError(result)) {
      throw new AgentAbort({
        reply:
          "Your Salesforce session expired while the agent was working. " +
          "Reload the page and log in again, then retry.",
        sessionExpired: true,
      });
    }

    if (typeof result.error === "string") {
      errorCount += 1;
      lastError = result.error;
    }

    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
      is_error: typeof result.error === "string",
    });
  }

  return { results, errorCount, lastError };
}

// Runs the Claude<->tool loop from an existing message list. Returns a
// final reply, or (when a destructive tool is proposed) stashes the
// transcript on the session and returns a confirmation prompt.
async function runLoop(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  sf: SalesforceSession,
  session: ChatSession,
): Promise<AgentReply> {
  let consecutiveErrorTurns = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await createMessage(client, messages);

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return { reply: extractText(response) || "The agent finished without a text reply." };
    }

    const toolUses = response.content.filter(isToolUse);
    const destructive = toolUses.filter((block) => DESTRUCTIVE_TOOLS.has(block.name));

    if (destructive.length > 0) {
      const preamble = extractText(response);
      const preview = describePendingActions(destructive);
      session.agentPending = {
        messages,
        toolUseIds: toolUses.map((block) => block.id),
        summary: preview,
        createdAt: Date.now(),
      };
      return {
        reply:
          (preamble ? `${preamble}\n\n` : "") +
          `${preview}\n\nReply "yes" to proceed or "no" to cancel.`,
        awaitingConfirmation: true,
      };
    }

    const outcome = await executeToolUses(toolUses, sf);
    messages.push({ role: "user", content: outcome.results });

    if (toolUses.length > 0 && outcome.errorCount === toolUses.length) {
      consecutiveErrorTurns += 1;
      if (consecutiveErrorTurns >= MAX_CONSECUTIVE_ERROR_TURNS) {
        throw new AgentAbort({
          reply:
            "The agent kept hitting errors trying to do that. The last one was:\n\n" +
            `> ${outcome.lastError ?? "unknown error"}\n\n` +
            "Try rephrasing the request, or double-check the object and field names.",
        });
      }
    } else {
      consecutiveErrorTurns = 0;
    }
  }

  return {
    reply:
      "The agent reached its step limit before finishing this request. Try " +
      "breaking it into smaller steps.",
  };
}

async function resumePending(
  client: Anthropic,
  message: string,
  sf: SalesforceSession,
  session: ChatSession,
): Promise<AgentReply> {
  const pending = session.agentPending;
  if (!pending) {
    // Shouldn't happen — caller checks — but keep the types honest.
    return runFresh(client, message, sf, session);
  }

  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    session.agentPending = undefined;
    return runFresh(client, message, sf, session);
  }

  const decision = classifyConfirmation(message);
  if (decision === "unclear") {
    return {
      reply:
        `You have an action waiting for confirmation:\n\n${pending.summary}\n\n` +
        `Reply "yes" to proceed or "no" to cancel.`,
      awaitingConfirmation: true,
    };
  }

  const messages = pending.messages as Anthropic.MessageParam[];
  const lastAssistant = messages[messages.length - 1];
  const toolUses = Array.isArray(lastAssistant?.content)
    ? (lastAssistant.content as Anthropic.ContentBlock[]).filter(isToolUse)
    : [];

  session.agentPending = undefined;

  const outcome =
    decision === "no"
      ? await executeToolUses(toolUses, sf, { declined: true })
      : await executeToolUses(toolUses, sf);
  messages.push({ role: "user", content: outcome.results });

  return runLoop(client, messages, sf, session);
}

async function runFresh(
  client: Anthropic,
  message: string,
  sf: SalesforceSession,
  session: ChatSession,
): Promise<AgentReply> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];
  return runLoop(client, messages, sf, session);
}

export async function runAgent(
  message: string,
  sf: SalesforceSession,
  session: ChatSession,
): Promise<AgentReply> {
  const client = getClient();
  if (!client) {
    return {
      reply:
        "The agent isn't configured yet. Set ANTHROPIC_API_KEY in the server " +
        "environment and restart the server.",
    };
  }

  try {
    if (session.agentPending) {
      return await resumePending(client, message, sf, session);
    }
    return await runFresh(client, message, sf, session);
  } catch (error) {
    if (error instanceof AgentAbort) {
      // A partial pending action is no longer resumable once we've bailed.
      session.agentPending = undefined;
      return error.reply;
    }
    throw error;
  }
}
