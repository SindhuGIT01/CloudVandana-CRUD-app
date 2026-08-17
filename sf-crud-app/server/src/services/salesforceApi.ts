import type { SalesforceSession } from "../auth/session.js";

export class SalesforceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SalesforceApiError";
  }
}

// Thin wrapper around the Salesforce REST API using the tokens requireAuth
// already validated/refreshed onto the session — every route under /api
// calls Salesforce through this instead of building fetch calls by hand.
export async function sfApiGet<T>(
  sf: SalesforceSession,
  path: string,
): Promise<T> {
  const response = await fetch(new URL(path, sf.instanceUrl), {
    headers: { Authorization: `Bearer ${sf.accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new SalesforceApiError(
      `Salesforce API request to ${path} failed (${response.status}): ${body}`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
