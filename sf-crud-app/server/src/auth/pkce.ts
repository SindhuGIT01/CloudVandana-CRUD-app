import crypto from "node:crypto";

// PKCE (RFC 7636): the verifier is a secret only the server ever sees; the
// challenge (its SHA-256 hash) is safe to send to Salesforce up front. When
// the code is redeemed, Salesforce checks the verifier hashes back to the
// challenge it was given — proving the app completing the exchange is the
// same one that started it, even though a Connected App client_secret is
// also in play. Salesforce's OAuth login docs describe this alongside every
// External Client App Web Server flow example.
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}
