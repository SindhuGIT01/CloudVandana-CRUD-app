// Keep in sync with server/src/config/constants.ts's ALLOWED_SOBJECTS.
// There's no shared package between client and server in this project, so
// this whitelist is intentionally duplicated here for the dropdown — the
// server is still the real enforcement point, this just drives the UI.
export const SALESFORCE_OBJECTS = ["Account", "Opportunity", "Lead", "Contact", "Case"] as const;
export type SalesforceObject = (typeof SALESFORCE_OBJECTS)[number];

export const MIN_SELECTED_FIELDS = 5;
export const MAX_SELECTED_FIELDS = 10;
