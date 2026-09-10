import "express-session";

export interface SalesforceSession {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  // ms epoch timestamp of when accessToken was (last) issued —
  // used by requireAuth to decide when to proactively refresh.
  issuedAt: number;
}

// A destructive tool call the agent has proposed and is waiting for the
// user to confirm. The reasoning loop pauses, stashes the transcript here,
// and resumes on the next request once the user replies yes/no. `messages`
// holds Anthropic MessageParam objects (kept as `unknown[]` so this module
// stays free of the SDK types); runAgent casts it back.
export interface AgentPendingAction {
  messages: unknown[];
  toolUseIds: string[];
  summary: string;
  createdAt: number;
}

declare module "express-session" {
  interface SessionData {
    sf?: SalesforceSession;
    oauthState?: string;
    pkceVerifier?: string;
    agentPending?: AgentPendingAction;
  }
}
