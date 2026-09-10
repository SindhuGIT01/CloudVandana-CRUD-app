// Agent tool definitions + their executors.
//
// Task 2 fills this in: each existing CRUD capability
// (search_records / get_record / create_record / update_record /
// delete_record) is described here in Anthropic's tool-calling format,
// paired with an executor that calls the existing
// `services/salesforceApi.ts` helpers in-process — no HTTP self-calls,
// so the token refresh `requireAuth` already did is reused for free.
//
// Kept as an empty stub for Task 0 so the folder structure exists
// without committing to an API shape the Anthropic SDK docs will pin
// down in Task 2.

export const AGENT_TOOLS: unknown[] = [];
