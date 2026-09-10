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

const SYSTEM_PROMPT = `You are the Salesforce Ops Agent for a CRUD app. A user types a plain-English request and you carry it out by calling the provided tools against their Salesforce org.

You can work with five objects: Account, Opportunity, Lead, Contact, and Case.

Work in a search -> decide -> act loop:
1. SEARCH: call search_records with filters so Salesforce does the filtering. For date/time comparisons pass SOQL literals with value_is_literal: true (e.g. LAST_N_DAYS:90, TODAY, 2026-01-01). Request the Id plus any fields you need to reason about (e.g. LastActivityDate, Amount, StageName).
2. DECIDE: from the returned records, work out which Ids actually match the user's intent. If nothing matches, say so.
3. ACT: for one record use update_record / delete_record. For several, collect their Ids and make ONE update_records / delete_records call (up to 200 Ids) rather than many single calls.

Other guidelines:
- Never guess an Id - always get it from a search_records result first.
- Request only the fields you need. Case has no Name field - use fields like CaseNumber, Subject, Status, Priority.
- If a request is ambiguous (which object? which record? what new value? what does "close" mean for this object?), ask the user a short clarifying question instead of guessing.
- The app pauses and asks the user to confirm before any update or delete actually runs, so you don't need to ask for confirmation yourself - just call the tool. Before calling a destructive tool, write a short line naming the records you're about to change.
- When a tool returns an { error }, read it, and either fix the arguments and retry or explain the problem to the user.
- Keep your final answer short and readable: say what you found or did in plain sentences, not raw JSON. Include record counts and the names/numbers of affected records, and call out any that failed.`;

export interface AgentReply {
  reply: string;
  awaitingConfirmation?: boolean;
}

type ChatSession = Session & Partial<SessionData>;

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
        return `• Delete 1 ${object} (${String(input.id)}).`;
      case "update_record":
        return `• Update ${object} ${String(input.id)}: set ${renderFieldChanges(input.fields)}.`;
      case "delete_records":
        return `• Delete ${Array.isArray(input.ids) ? input.ids.length : "?"} ${object} records: ${summarizeIds(input.ids)}.`;
      case "update_records":
        return `• Update ${Array.isArray(input.ids) ? input.ids.length : "?"} ${object} records (${summarizeIds(input.ids)}): set ${renderFieldChanges(input.fields)}.`;
      default:
        return `• ${block.name}`;
    }
  });
  return `This will change your Salesforce data:\n${lines.join("\n")}`;
}

function isToolUse(block: Anthropic.ContentBlock): block is Anthropic.ToolUseBlock {
  return block.type === "tool_use";
}

async function executeToolUses(
  blocks: Anthropic.ToolUseBlock[],
  sf: SalesforceSession,
  options: { declined?: boolean } = {},
): Promise<Anthropic.ToolResultBlockParam[]> {
  const results: Anthropic.ToolResultBlockParam[] = [];
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
    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(result),
      is_error: typeof result.error === "string",
    });
  }
  return results;
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
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS,
      messages,
    });

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

    messages.push({ role: "user", content: await executeToolUses(toolUses, sf) });
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

  if (decision === "no") {
    messages.push({
      role: "user",
      content: await executeToolUses(toolUses, sf, { declined: true }),
    });
  } else {
    messages.push({ role: "user", content: await executeToolUses(toolUses, sf) });
  }

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

  if (session.agentPending) {
    return resumePending(client, message, sf, session);
  }
  return runFresh(client, message, sf, session);
}
