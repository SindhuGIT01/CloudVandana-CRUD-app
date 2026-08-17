import crypto from "node:crypto";
import { Router } from "express";
import { generateCodeChallenge, generateCodeVerifier } from "../auth/pkce.js";
import { buildAuthorizeUrl, exchangeCodeForToken } from "../auth/salesforce.js";
import { env } from "../config/env.js";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  // Random, unguessable value that we check on callback so a malicious
  // redirect can't forge a completed login (CSRF protection for the flow).
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  // PKCE: this org's External Client App requires a code_challenge on the
  // authorize request; the matching verifier is redeemed in /callback.
  const codeVerifier = generateCodeVerifier();
  req.session.pkceVerifier = codeVerifier;
  const codeChallenge = generateCodeChallenge(codeVerifier);

  res.redirect(buildAuthorizeUrl(state, codeChallenge));
});

authRouter.get("/callback", async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    res.status(400).send(`Salesforce login failed: ${errorDescription ?? error}`);
    return;
  }

  const expectedState = req.session.oauthState;
  req.session.oauthState = undefined;
  const codeVerifier = req.session.pkceVerifier;
  req.session.pkceVerifier = undefined;

  if (
    typeof code !== "string" ||
    typeof state !== "string" ||
    state !== expectedState ||
    !codeVerifier
  ) {
    res.status(400).send("Invalid or missing OAuth state/code.");
    return;
  }

  try {
    const token = await exchangeCodeForToken(code, codeVerifier);

    if (!token.refresh_token) {
      throw new Error(
        "Salesforce did not return a refresh_token. Ensure the connected app / " +
          "External Client App's OAuth scopes include 'refresh_token' (or 'offline_access').",
      );
    }

    req.session.sf = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      instanceUrl: token.instance_url,
      issuedAt: Date.now(),
    };

    res.redirect(`${env.clientUrl}/dashboard`);
  } catch (err) {
    console.error("Salesforce OAuth callback failed:", err);
    res.status(500).send("Failed to complete Salesforce login.");
  }
});

// Cheap, side-effect-free check the client polls to know whether it should
// show the login button or the dashboard. Deliberately does NOT reuse
// requireAuth here — a status check shouldn't trigger a token refresh (and
// the extra Salesforce round trip that comes with it) just to answer yes/no.
authRouter.get("/status", (req, res) => {
  res.json({ authenticated: Boolean(req.session.sf) });
});

authRouter.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Failed to destroy session:", err);
      res.status(500).json({ error: "Failed to log out." });
      return;
    }
    res.clearCookie("connect.sid");
    res.redirect(env.clientUrl);
  });
});
