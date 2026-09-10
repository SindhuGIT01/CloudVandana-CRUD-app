// Input validation shared by the agent's tool executors.
//
// These patterns mirror the ones the /api/records routes use — the agent
// builds SOQL and hits the same Salesforce endpoints, so it needs the same
// guardrails against injection via field names / record Ids.

// Field names are interpolated straight into a SOQL SELECT/WHERE/ORDER BY
// clause, so they're restricted to identifier characters plus dots (for
// relationship fields like "Account.Name").
export const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

// 15-char case-sensitive or 18-char case-insensitive Salesforce record Id.
export const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

export function isValidFieldName(value: string): boolean {
  return FIELD_NAME_PATTERN.test(value);
}

export function isValidSalesforceId(value: string): boolean {
  return SF_ID_PATTERN.test(value);
}

// Wrap a string value for a SOQL clause: single-quote it and escape the
// characters Salesforce treats specially inside a quoted string.
export function quoteSoqlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `'${escaped}'`;
}
