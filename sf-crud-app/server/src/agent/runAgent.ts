// The agent reasoning loop.
//
// Takes a user chat message, sends it to Claude together with the tool
// definitions from `tools.ts`, and runs a manual tool-use loop: Claude
// decides which backend operation(s) to call and with what arguments, we
// execute them in-process against Salesforce, feed the results back, and
// repeat until Claude produces a final text answer.
//
// Task 4 tunes this for multi-step bulk requests (search -> decide -> act
// over many records). Task 5 adds a confirmation pause before destructive
// tools. Task 6 improves how results are phrased. Task 7 hardens errors.

import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import type { SalesforceSession } from "../auth/session.js";
import { executeTool } from "./executeTool.js";
import { AGENT_TOOLS } from "./tools.js";

const MODEL = "claude-opus-5";
const MAX_TOKENS = 16000;

// Hard cap on Claude<->tool round trips per message, so a confused model
// can't loop forever (and run up cost) on a single request. Bulk requests
// still resolve in a few turns because update_records / delete_records act
// on up to 200 records at once.
const MAX_ITERATIONS = 20;

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
- When a tool returns an { error }, read it, and either fix the arguments and retry or explain the problem to the user.
- Keep your final answer short and readable: say what you found or did in plain sentences, not raw JSON. Include record counts and the names/numbers of affected records, and call out any that failed.`;

export interface AgentReply {
  reply: string;
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

export async function runAgent(
  message: string,
  sf: SalesforceSession,
): Promise<AgentReply> {
  const client = getClient();
  if (!client) {
    return {
      reply:
        "The agent isn't configured yet. Set ANTHROPIC_API_KEY in the server " +
        "environment and restart the server.",
    };
  }

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: message }];

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
      return {
        reply: extractText(response) || "The agent finished without a text reply.",
      };
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const result = await executeTool(
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        sf,
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
        is_error: typeof result.error === "string",
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return {
    reply:
      "The agent reached its step limit before finishing this request. Try " +
      "breaking it into smaller steps.",
  };
}
