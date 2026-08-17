export const SF_API_VERSION = "v61.0";

// Objects the app is allowed to touch via /api routes — keeps the app scoped
// to what it's actually meant to manage instead of exposing every object in
// the connected org (custom objects, setup metadata, etc).
export const ALLOWED_SOBJECTS = [
  "Account",
  "Opportunity",
  "Lead",
  "Contact",
  "Case",
] as const;

export type AllowedSObject = (typeof ALLOWED_SOBJECTS)[number];

export function isAllowedSObject(value: string): value is AllowedSObject {
  return (ALLOWED_SOBJECTS as readonly string[]).includes(value);
}
