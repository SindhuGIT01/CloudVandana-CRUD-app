import type Anthropic from "@anthropic-ai/sdk";
import { ALLOWED_SOBJECTS } from "../config/constants.js";

// The CRUD capabilities, described in Anthropic's tool-calling format so
// Claude can pick which one(s) to call and with what arguments. Executors
// live in executeTool.ts; the reasoning loop that hands these to Claude is
// in runAgent.ts.

const objectProperty = {
  type: "string",
  enum: [...ALLOWED_SOBJECTS],
  description: "The Salesforce object type to act on.",
};

const filtersProperty = {
  type: "array",
  description:
    "Filter conditions, all combined with AND. Omit to match every record of " +
    "this object. Each condition compares one field to a value.",
  items: {
    type: "object",
    properties: {
      field: {
        type: "string",
        description: "API name of the field to filter on, e.g. StageName, Amount, CreatedDate.",
      },
      operator: {
        type: "string",
        enum: ["=", "!=", "<", "<=", ">", ">=", "LIKE", "IN"],
        description: "Comparison operator. Use IN with an array value.",
      },
      value: {
        description:
          "Value to compare against. A JSON string is matched literally (quoted for " +
          "you). A JSON number or boolean is used as-is. Use an array with the IN operator.",
      },
      value_is_literal: {
        type: "boolean",
        description:
          "Set true when the value is a SOQL literal that must NOT be quoted: a date " +
          "(2024-06-01), a datetime (2024-06-01T00:00:00Z), a relative date literal such as " +
          "LAST_N_DAYS:90 or TODAY, or NULL. Defaults to false.",
      },
    },
    required: ["field", "operator", "value"],
    additionalProperties: false,
  },
};

const fieldsListProperty = {
  type: "array",
  items: { type: "string" },
  description:
    "API names of fields to return. Defaults to Id and Name. Always include Id when " +
    "you intend to update or delete the results afterward.",
};

const fieldMapProperty = {
  type: "object",
  description:
    'Field API names mapped to their values, e.g. { "LastName": "Rao", "Company": "Acme" }. ' +
    "Include every field Salesforce requires for this object.",
  additionalProperties: true,
};

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_records",
    description:
      "Search for Salesforce records of one object type, optionally filtered. Returns the " +
      "matching records with the requested fields. Use this first to find records before " +
      "acting on them.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        filters: filtersProperty,
        fields: fieldsListProperty,
        order_by: {
          type: "object",
          description:
            "Sort order. Defaults to Id ascending. Use e.g. { field: \"CreatedDate\", " +
            "direction: \"DESC\" } for newest-first, or { field: \"Amount\", direction: \"DESC\" } " +
            "for largest-first.",
          properties: {
            field: { type: "string", description: "Field API name to sort by." },
            direction: {
              type: "string",
              enum: ["ASC", "DESC"],
              description: "Sort direction. Defaults to ASC.",
            },
          },
          required: ["field"],
          additionalProperties: false,
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 200,
          description: "Maximum records to return (default 50, hard cap 200).",
        },
      },
      required: ["object"],
      additionalProperties: false,
    },
  },
  {
    name: "get_record",
    description: "Fetch a single Salesforce record by its Id, with the requested fields.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        id: {
          type: "string",
          description: "The 15- or 18-character Salesforce record Id.",
        },
        fields: fieldsListProperty,
      },
      required: ["object", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_record",
    description: "Create a new Salesforce record of the given object type.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        fields: fieldMapProperty,
      },
      required: ["object", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "update_record",
    description:
      "Update fields on an existing Salesforce record. Destructive — the agent asks the " +
      "user to confirm before this actually runs.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        id: { type: "string", description: "The Salesforce record Id to update." },
        fields: {
          ...fieldMapProperty,
          description: "Field API names mapped to their new values.",
        },
      },
      required: ["object", "id", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_record",
    description:
      "Delete a Salesforce record by Id. Destructive — the agent asks the user to confirm " +
      "before this actually runs.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        id: { type: "string", description: "The Salesforce record Id to delete." },
      },
      required: ["object", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "update_records",
    description:
      "Apply the SAME field changes to many records of one object type in a single call. " +
      "Use this instead of repeated update_record calls when acting on more than a couple " +
      "of records (e.g. closing every stale opportunity). Destructive — the agent asks the " +
      "user to confirm before this runs.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 200,
          description: "Record Ids to update, from a prior search_records call. Max 200 per call.",
        },
        fields: {
          ...fieldMapProperty,
          description: "Field API names mapped to the new values applied to every listed record.",
        },
      },
      required: ["object", "ids", "fields"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_records",
    description:
      "Delete many records of one object type in a single call. Use this instead of repeated " +
      "delete_record calls. Destructive — the agent asks the user to confirm before this runs.",
    input_schema: {
      type: "object",
      properties: {
        object: objectProperty,
        ids: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 200,
          description: "Record Ids to delete, from a prior search_records call. Max 200 per call.",
        },
      },
      required: ["object", "ids"],
      additionalProperties: false,
    },
  },
];

// Tools that write to Salesforce and must be confirmed with the user
// before running — runAgent.ts pauses the loop on any of these.
export const DESTRUCTIVE_TOOLS = new Set<string>([
  "update_record",
  "delete_record",
  "update_records",
  "delete_records",
]);
