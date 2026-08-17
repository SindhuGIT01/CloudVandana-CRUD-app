import type { Response as ExpressResponse } from "express";
import type { SalesforceSession } from "../auth/session.js";

// Salesforce's REST API returns errors as a JSON array of these, not a
// single object — e.g. [{ "message": "Required fields are missing: [Name]",
// "errorCode": "REQUIRED_FIELD_MISSING", "fields": ["Name"] }].
export interface SalesforceErrorDetail {
  message: string;
  errorCode: string;
  fields?: string[];
}

export class SalesforceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: SalesforceErrorDetail[],
  ) {
    super(message);
    this.name = "SalesforceApiError";
  }
}

async function sfFetch(
  sf: SalesforceSession,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(new URL(path, sf.instanceUrl), {
    ...init,
    headers: {
      Authorization: `Bearer ${sf.accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const rawBody = await response.text();
    let details: SalesforceErrorDetail[] | undefined;
    let message = `Salesforce API request to ${path} failed (${response.status})`;

    try {
      const parsed: unknown = rawBody ? JSON.parse(rawBody) : undefined;
      if (Array.isArray(parsed) && parsed.length > 0) {
        details = parsed as SalesforceErrorDetail[];
        message = details.map((detail) => detail.message).join("; ");
      }
    } catch {
      if (rawBody) {
        message = `${message}: ${rawBody}`;
      }
    }

    throw new SalesforceApiError(message, response.status, details);
  }

  return response;
}

// Thin wrapper around the Salesforce REST API using the tokens requireAuth
// already validated/refreshed onto the session — every route under /api
// calls Salesforce through this instead of building fetch calls by hand.
export async function sfApiGet<T>(
  sf: SalesforceSession,
  path: string,
): Promise<T> {
  const response = await sfFetch(sf, path);
  return (await response.json()) as T;
}

export async function sfApiPost<T>(
  sf: SalesforceSession,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await sfFetch(sf, path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return (await response.json()) as T;
}

// Salesforce returns 204 No Content on a successful update — nothing to parse.
export async function sfApiPatch(
  sf: SalesforceSession,
  path: string,
  body: unknown,
): Promise<void> {
  await sfFetch(sf, path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// Salesforce returns 204 No Content on a successful delete — nothing to parse.
export async function sfApiDelete(sf: SalesforceSession, path: string): Promise<void> {
  await sfFetch(sf, path, { method: "DELETE" });
}

// Shared by every /api/objects and /api/records route so Salesforce failures
// come back to the client as one consistent JSON error shape.
export function sendSalesforceError(
  res: ExpressResponse,
  error: unknown,
  action: string,
): void {
  if (error instanceof SalesforceApiError) {
    // Pass through Salesforce's own 4xx (bad request, not found, forbidden —
    // all meaningful to the client); anything else is an upstream failure.
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    res.status(status).json({ error: error.message, details: error.details });
    return;
  }
  console.error(`Failed to ${action}:`, error);
  res.status(500).json({ error: `Failed to ${action}.` });
}
