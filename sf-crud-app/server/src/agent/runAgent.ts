// The agent reasoning loop.
//
// Task 3: take a user chat message, call Claude with the tool
// definitions from `tools.ts`, and let Claude decide which backend
// operation(s) to run.
// Task 4: the multi-step search -> decide -> act loop (call tools
// repeatedly for bulk requests).
// Task 5: pause before any destructive action and require a yes/no.
//
// Stubbed for Task 0 so the route can import a real function.

import type { SalesforceSession } from "../auth/session.js";

export interface AgentReply {
  reply: string;
}

export async function runAgent(
  _message: string,
  _sf: SalesforceSession,
): Promise<AgentReply> {
  return {
    reply:
      "The Salesforce Ops Agent isn't wired up yet — this is the Task 0 scaffold. " +
      "The reasoning loop lands in Task 3.",
  };
}
