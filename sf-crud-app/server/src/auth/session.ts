import "express-session";

export interface SalesforceSession {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
  // ms epoch timestamp of when accessToken was (last) issued —
  // used by requireAuth to decide when to proactively refresh.
  issuedAt: number;
}

declare module "express-session" {
  interface SessionData {
    sf?: SalesforceSession;
    oauthState?: string;
    pkceVerifier?: string;
  }
}
