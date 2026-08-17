import { env } from "../config/env.js";

export interface SalesforceTokenResponse {
  access_token: string;
  // Salesforce omits refresh_token on a refresh_token grant response —
  // it only ever issues a new one on the initial authorization_code exchange.
  refresh_token?: string;
  instance_url: string;
  id: string;
  token_type: string;
  issued_at: string;
  signature: string;
}

export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const url = new URL("/services/oauth2/authorize", env.sfLoginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function requestToken(
  params: Record<string, string>,
): Promise<SalesforceTokenResponse> {
  const response = await fetch(new URL("/services/oauth2/token", env.sfLoginUrl), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Salesforce token request failed (${response.status}): ${errorBody}`,
    );
  }

  return (await response.json()) as SalesforceTokenResponse;
}

export function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<SalesforceTokenResponse> {
  return requestToken({
    grant_type: "authorization_code",
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    code_verifier: codeVerifier,
  });
}

export function refreshAccessToken(
  refreshToken: string,
): Promise<SalesforceTokenResponse> {
  return requestToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.clientId,
    client_secret: env.clientSecret,
  });
}
