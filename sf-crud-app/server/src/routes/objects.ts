import { Router } from "express";
import { ALLOWED_SOBJECTS, isAllowedSObject, SF_API_VERSION } from "../config/constants.js";
import { SalesforceApiError, sfApiGet } from "../services/salesforceApi.js";

interface SalesforceDescribeField {
  name: string;
  label: string;
  type: string;
  updateable: boolean;
  createable: boolean;
}

interface SalesforceDescribeResponse {
  fields: SalesforceDescribeField[];
}

interface SimplifiedField {
  name: string;
  label: string;
  type: string;
  updateable: boolean;
  createable: boolean;
}

export const objectsRouter = Router();

objectsRouter.get("/:objectName/fields", async (req, res) => {
  const { objectName } = req.params;

  if (!isAllowedSObject(objectName)) {
    res.status(400).json({
      error: `Unsupported object "${objectName}". Allowed objects: ${ALLOWED_SOBJECTS.join(", ")}.`,
    });
    return;
  }

  // requireAuth already guarantees this on every /api/* route; this check
  // exists only so TypeScript can narrow req.session.sf from optional to set.
  const sf = req.session.sf;
  if (!sf) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    const describe = await sfApiGet<SalesforceDescribeResponse>(
      sf,
      `/services/data/${SF_API_VERSION}/sobjects/${objectName}/describe`,
    );

    const fields: SimplifiedField[] = describe.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      updateable: field.updateable,
      createable: field.createable,
    }));

    res.json(fields);
  } catch (error) {
    if (error instanceof SalesforceApiError) {
      res.status(error.status === 404 ? 404 : 502).json({ error: error.message });
      return;
    }
    console.error("Failed to describe Salesforce object:", error);
    res.status(500).json({ error: "Failed to fetch object fields." });
  }
});
