import type { NextFunction, Request, Response } from "express";
import { refreshAccessToken } from "../auth/salesforce.js";

// Salesforce's token response never includes an "expires_in" field — token
// lifetime is controlled by the org's Session Timeout setting instead, and
// the server can't know that value in advance. 100 minutes is a conservative
// buffer under Salesforce's default 2-hour timeout, so we refresh proactively
// before the access token is likely to have actually expired.
const ACCESS_TOKEN_MAX_AGE_MS = 100 * 60 * 1000;

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sf = req.session.sf;

  if (!sf) {
    res.status(401).json({ error: "Not authenticated. Log in at /auth/login." });
    return;
  }

  const isStale = Date.now() - sf.issuedAt > ACCESS_TOKEN_MAX_AGE_MS;

  if (!isStale) {
    next();
    return;
  }

  try {
    const refreshed = await refreshAccessToken(sf.refreshToken);
    req.session.sf = {
      accessToken: refreshed.access_token,
      refreshToken: sf.refreshToken,
      instanceUrl: refreshed.instance_url,
      issuedAt: Date.now(),
    };
    next();
  } catch (error) {
    console.error("Failed to refresh Salesforce access token:", error);
    req.session.sf = undefined;
    res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
