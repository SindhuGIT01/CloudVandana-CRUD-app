// Executors for the agent's tools.
//
// Each tool defined in `tools.ts` maps to one function here. They call the
// existing salesforceApi.ts helpers in-process (no HTTP self-calls) using the
// session that requireAuth already validated/refreshed, so the agent can
// never run without an authenticated Salesforce session and reuses the same
// token-refresh the rest of /api relies on.
//
// executeTool() always resolves to a plain JSON-serializable object — on
// failure it returns { error } (plus Salesforce's { details } when present)
// rather than throwing, so the reasoning loop can feed the problem back to
// Claude and let it recover or ask the user.

import { isAllowedSObject, SF_API_VERSION } from "../config/constants.js";
import type { SalesforceSession } from "../auth/session.js";
import {
  SalesforceApiError,
  sfApiDelete,
  sfApiGet,
  sfApiPatch,
  sfApiPost,
} from "../services/salesforceApi.js";
import { isValidFieldName, isValidSalesforceId, quoteSoqlString } from "./validation.js";

export type ToolInput = Record<string, unknown>;
export type ToolResult = Record<string, unknown>;

const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 200;
const MAX_BULK_IDS = 200;
const DEFAULT_FIELDS = ["Id", "Name"];

const FILTER_OPERATORS = new Set(["=", "!=", "<", "<=", ">", ">=", "LIKE", "IN"]);

// Thrown for bad tool arguments; caught in executeTool and turned into an
// { error } result so Claude sees a readable message instead of a crash.
class ToolArgumentError extends Error {}

interface SoqlQueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

interface Filter {
  field: string;
  operator: string;
  value: unknown;
  value_is_literal?: boolean;
}

function requireObject(input: ToolInput): string {
  const object = input.object;
  if (typeof object !== "string" || !isAllowedSObject(object)) {
    throw new ToolArgumentError(
      `"object" must be one of Account, Opportunity, Lead, Contact, Case (got ${JSON.stringify(object)}).`,
    );
  }
  return object;
}

function resolveFields(input: ToolInput): string[] {
  const raw = input.fields;
  if (raw === undefined) return [...DEFAULT_FIELDS];
  if (!Array.isArray(raw) || raw.some((f) => typeof f !== "string")) {
    throw new ToolArgumentError('"fields" must be an array of field-name strings.');
  }
  const fields = (raw as string[]).map((f) => f.trim()).filter(Boolean);
  if (fields.length === 0) return [...DEFAULT_FIELDS];
  const bad = fields.find((f) => !isValidFieldName(f));
  if (bad) throw new ToolArgumentError(`Invalid field name "${bad}".`);
  if (!fields.some((f) => f.toLowerCase() === "id")) fields.unshift("Id");
  return fields;
}

// Render one filter value for a SOQL clause. Strings are quoted/escaped;
// numbers and booleans pass through; value_is_literal lets the model supply
// an unquoted SOQL literal (a date, LAST_N_DAYS:90, TODAY, NULL, ...).
function renderScalar(value: unknown, isLiteral: boolean | undefined): string {
  if (isLiteral) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ToolArgumentError("A literal filter value must be a non-empty string.");
    }
    if (!/^[A-Za-z0-9_:.+\-T ]+$/.test(value)) {
      throw new ToolArgumentError(`Unsupported SOQL literal "${value}".`);
    }
    return value.trim();
  }
  if (value === null) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return quoteSoqlString(value);
  throw new ToolArgumentError(`Unsupported filter value ${JSON.stringify(value)}.`);
}

function renderFilter(filter: Filter): string {
  if (typeof filter?.field !== "string" || !isValidFieldName(filter.field)) {
    throw new ToolArgumentError(`Invalid filter field "${filter?.field}".`);
  }
  const operator = String(filter.operator ?? "").toUpperCase();
  if (!FILTER_OPERATORS.has(operator)) {
    throw new ToolArgumentError(`Unsupported filter operator "${filter.operator}".`);
  }

  if (operator === "IN") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw new ToolArgumentError('The "IN" operator needs a non-empty array value.');
    }
    const list = filter.value.map((v) => renderScalar(v, filter.value_is_literal)).join(", ");
    return `${filter.field} IN (${list})`;
  }

  return `${filter.field} ${operator} ${renderScalar(filter.value, filter.value_is_literal)}`;
}

function buildWhereClause(input: ToolInput): string {
  const raw = input.filters;
  if (raw === undefined) return "";
  if (!Array.isArray(raw)) throw new ToolArgumentError('"filters" must be an array.');
  if (raw.length === 0) return "";
  const clauses = (raw as Filter[]).map(renderFilter);
  return ` WHERE ${clauses.join(" AND ")}`;
}

function resolveOrderBy(input: ToolInput): string {
  const raw = input.order_by;
  if (raw === undefined || raw === null) return "ORDER BY Id";
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolArgumentError('"order_by" must be an object like { field, direction }.');
  }
  const { field, direction } = raw as Record<string, unknown>;
  if (typeof field !== "string" || !isValidFieldName(field)) {
    throw new ToolArgumentError(`Invalid order_by field "${String(field)}".`);
  }
  const dir = String(direction ?? "ASC").toUpperCase();
  if (dir !== "ASC" && dir !== "DESC") {
    throw new ToolArgumentError('"order_by.direction" must be "ASC" or "DESC".');
  }
  return `ORDER BY ${field} ${dir}`;
}

function resolveLimit(input: ToolInput): number {
  const raw = input.limit;
  if (raw === undefined) return DEFAULT_SEARCH_LIMIT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new ToolArgumentError('"limit" must be a positive integer.');
  }
  return Math.min(raw, MAX_SEARCH_LIMIT);
}

function requireId(input: ToolInput): string {
  const id = input.id;
  if (typeof id !== "string" || !isValidSalesforceId(id)) {
    throw new ToolArgumentError(`"id" must be a 15- or 18-character Salesforce Id (got ${JSON.stringify(id)}).`);
  }
  return id;
}

function requireFieldMap(input: ToolInput): Record<string, unknown> {
  const fields = input.fields;
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    throw new ToolArgumentError('"fields" must be an object mapping field names to values.');
  }
  const entries = Object.entries(fields as Record<string, unknown>);
  if (entries.length === 0) throw new ToolArgumentError('"fields" cannot be empty.');
  const bad = entries.find(([name]) => !isValidFieldName(name));
  if (bad) throw new ToolArgumentError(`Invalid field name "${bad[0]}".`);
  return fields as Record<string, unknown>;
}

function requireIdList(input: ToolInput): string[] {
  const raw = input.ids;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolArgumentError('"ids" must be a non-empty array of Salesforce Ids.');
  }
  const ids = Array.from(
    new Set(raw.map((v) => (typeof v === "string" ? v.trim() : ""))),
  );
  if (ids.some((id) => id === "")) {
    throw new ToolArgumentError('"ids" must contain only non-empty Id strings.');
  }
  const bad = ids.find((id) => !isValidSalesforceId(id));
  if (bad) throw new ToolArgumentError(`Invalid Salesforce Id "${bad}".`);
  if (ids.length > MAX_BULK_IDS) {
    throw new ToolArgumentError(
      `Too many ids (${ids.length}); act on at most ${MAX_BULK_IDS} records per call.`,
    );
  }
  return ids;
}

async function searchRecords(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const fields = resolveFields(input);
  const where = buildWhereClause(input);
  const orderBy = resolveOrderBy(input);
  const limit = resolveLimit(input);

  const soql = `SELECT ${fields.join(", ")} FROM ${object}${where} ${orderBy} LIMIT ${limit}`;
  const result = await sfApiGet<SoqlQueryResult>(
    sf,
    `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
  );
  return {
    object,
    soql,
    totalSize: result.totalSize,
    returned: result.records.length,
    records: result.records,
  };
}

async function getRecord(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const id = requireId(input);
  const fields = resolveFields(input);

  const soql = `SELECT ${fields.join(", ")} FROM ${object} WHERE Id = ${quoteSoqlString(id)} LIMIT 1`;
  const result = await sfApiGet<SoqlQueryResult>(
    sf,
    `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
  );
  if (result.records.length === 0) {
    return { object, id, found: false };
  }
  return { object, id, found: true, record: result.records[0] };
}

async function createRecord(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const fields = requireFieldMap(input);
  const result = await sfApiPost<{ id: string; success: boolean }>(
    sf,
    `/services/data/${SF_API_VERSION}/sobjects/${object}`,
    fields,
  );
  return { object, created: true, id: result.id };
}

async function updateRecord(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const id = requireId(input);
  const fields = requireFieldMap(input);
  await sfApiPatch(sf, `/services/data/${SF_API_VERSION}/sobjects/${object}/${id}`, fields);
  return { object, id, updated: true, fields: Object.keys(fields) };
}

async function deleteRecord(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const id = requireId(input);
  await sfApiDelete(sf, `/services/data/${SF_API_VERSION}/sobjects/${object}/${id}`);
  return { object, id, deleted: true };
}

interface BulkOutcome {
  id: string;
  success: boolean;
  error?: string;
}

// The bulk executors loop over the single-record REST calls (one HTTP
// request per Id) and isolate per-record failures. Salesforce's composite
// "sobjects collections" endpoint could do this in one request; a plain
// loop is used here to keep salesforceApi.ts untouched and error handling
// obvious — fine for the record counts this app deals with.
async function updateRecords(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const ids = requireIdList(input);
  const fields = requireFieldMap(input);

  const results: BulkOutcome[] = [];
  for (const id of ids) {
    try {
      await sfApiPatch(sf, `/services/data/${SF_API_VERSION}/sobjects/${object}/${id}`, fields);
      results.push({ id, success: true });
    } catch (error) {
      results.push({
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  return {
    object,
    requested: ids.length,
    succeeded,
    failed: ids.length - succeeded,
    fields: Object.keys(fields),
    results,
  };
}

async function deleteRecords(input: ToolInput, sf: SalesforceSession): Promise<ToolResult> {
  const object = requireObject(input);
  const ids = requireIdList(input);

  const results: BulkOutcome[] = [];
  for (const id of ids) {
    try {
      await sfApiDelete(sf, `/services/data/${SF_API_VERSION}/sobjects/${object}/${id}`);
      results.push({ id, success: true });
    } catch (error) {
      results.push({
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  return {
    object,
    requested: ids.length,
    succeeded,
    failed: ids.length - succeeded,
    results,
  };
}

type Executor = (input: ToolInput, sf: SalesforceSession) => Promise<ToolResult>;

const EXECUTORS: Record<string, Executor> = {
  search_records: searchRecords,
  get_record: getRecord,
  create_record: createRecord,
  update_record: updateRecord,
  delete_record: deleteRecord,
  update_records: updateRecords,
  delete_records: deleteRecords,
};

export async function executeTool(
  name: string,
  input: ToolInput,
  sf: SalesforceSession,
): Promise<ToolResult> {
  const executor = EXECUTORS[name];
  if (!executor) {
    return { error: `Unknown tool "${name}".` };
  }

  try {
    return await executor(input ?? {}, sf);
  } catch (error) {
    if (error instanceof ToolArgumentError) {
      return { error: error.message };
    }
    if (error instanceof SalesforceApiError) {
      return { error: error.message, details: error.details, status: error.status };
    }
    console.error(`Tool "${name}" failed:`, error);
    return { error: `The "${name}" operation hit an unexpected error.` };
  }
}
