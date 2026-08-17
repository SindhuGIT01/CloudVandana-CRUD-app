import { Router } from "express";
import { ALLOWED_SOBJECTS, isAllowedSObject, SF_API_VERSION } from "../config/constants.js";
import {
  sendSalesforceError,
  sfApiDelete,
  sfApiGet,
  sfApiPatch,
  sfApiPost,
} from "../services/salesforceApi.js";

export const recordsRouter = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

// Field names go straight into a SOQL SELECT clause below, so they're
// restricted to identifier characters (plus dots, for relationship fields
// like "Account.Name") instead of being interpolated as-is — that's what
// keeps this safe from SOQL injection via the ?fields= query param.
const FIELD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/;

// Standard Salesforce record Id: 15 chars (case-sensitive) or the 18-char
// case-insensitive version. Rejecting anything else early avoids a round
// trip to Salesforce just to get back its own "invalid ID" error.
const SF_ID_PATTERN = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

// objectName is validated on every route under here — GET/POST at
// "/:objectName" and PATCH/DELETE at "/:objectName/:id" both match this
// prefix, since router.use() applies to the whole subtree.
recordsRouter.use("/:objectName", (req, res, next) => {
  const { objectName } = req.params;
  if (!isAllowedSObject(objectName)) {
    res.status(400).json({
      error: `Unsupported object "${objectName}". Allowed objects: ${ALLOWED_SOBJECTS.join(", ")}.`,
    });
    return;
  }
  next();
});

function parseNonNegativeInt(value: unknown, fallback: number): number | null {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

interface SoqlQueryResult {
  totalSize: number;
  done: boolean;
  records: Record<string, unknown>[];
}

recordsRouter.get("/:objectName", async (req, res) => {
  const { objectName } = req.params;
  // requireAuth already guarantees this on every /api/* route; this check
  // exists only so TypeScript can narrow req.session.sf from optional to set.
  const sf = req.session.sf;
  if (!sf) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const fields = (typeof req.query.fields === "string" ? req.query.fields : "")
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);

  if (fields.length === 0) {
    res.status(400).json({ error: "Query parameter 'fields' is required, e.g. ?fields=Id,Name." });
    return;
  }

  const invalidField = fields.find((field) => !FIELD_NAME_PATTERN.test(field));
  if (invalidField) {
    res.status(400).json({ error: `Invalid field name "${invalidField}".` });
    return;
  }

  const limit = parseNonNegativeInt(req.query.limit, DEFAULT_LIMIT);
  const offset = parseNonNegativeInt(req.query.offset, 0);

  if (limit === null || offset === null) {
    res.status(400).json({ error: "'limit' and 'offset' must be non-negative integers." });
    return;
  }
  if (limit < 1 || limit > MAX_LIMIT) {
    res.status(400).json({ error: `'limit' must be between 1 and ${MAX_LIMIT}.` });
    return;
  }

  const soql = `SELECT ${fields.join(", ")} FROM ${objectName} ORDER BY Id LIMIT ${limit} OFFSET ${offset}`;

  try {
    const result = await sfApiGet<SoqlQueryResult>(
      sf,
      `/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    );
    res.json({ totalSize: result.totalSize, limit, offset, records: result.records });
  } catch (error) {
    sendSalesforceError(res, error, "query records");
  }
});

function isPlainObjectBody(body: unknown): body is Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}

recordsRouter.post("/:objectName", async (req, res) => {
  const { objectName } = req.params;
  const sf = req.session.sf;
  if (!sf) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  if (!isPlainObjectBody(req.body)) {
    res.status(400).json({ error: "Request body must be a JSON object of field values." });
    return;
  }

  try {
    const result = await sfApiPost<{ id: string; success: boolean }>(
      sf,
      `/services/data/${SF_API_VERSION}/sobjects/${objectName}`,
      req.body,
    );
    res.status(201).json(result);
  } catch (error) {
    sendSalesforceError(res, error, "create record");
  }
});

recordsRouter.patch("/:objectName/:id", async (req, res) => {
  const { objectName, id } = req.params;
  const sf = req.session.sf;
  if (!sf) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  if (!SF_ID_PATTERN.test(id)) {
    res.status(400).json({ error: "Invalid Salesforce record Id." });
    return;
  }
  if (!isPlainObjectBody(req.body)) {
    res.status(400).json({ error: "Request body must be a JSON object of field values." });
    return;
  }

  try {
    await sfApiPatch(
      sf,
      `/services/data/${SF_API_VERSION}/sobjects/${objectName}/${id}`,
      req.body,
    );
    res.status(204).send();
  } catch (error) {
    sendSalesforceError(res, error, "update record");
  }
});

recordsRouter.delete("/:objectName/:id", async (req, res) => {
  const { objectName, id } = req.params;
  const sf = req.session.sf;
  if (!sf) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  if (!SF_ID_PATTERN.test(id)) {
    res.status(400).json({ error: "Invalid Salesforce record Id." });
    return;
  }

  try {
    await sfApiDelete(sf, `/services/data/${SF_API_VERSION}/sobjects/${objectName}/${id}`);
    res.status(204).send();
  } catch (error) {
    sendSalesforceError(res, error, "delete record");
  }
});
