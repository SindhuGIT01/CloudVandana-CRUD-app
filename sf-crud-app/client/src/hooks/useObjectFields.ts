import { useEffect, useState } from "react";

export interface SalesforceField {
  name: string;
  label: string;
  type: string;
  updateable: boolean;
  createable: boolean;
}

export type ObjectFieldsStatus = "idle" | "loading" | "error" | "ready";

interface ErrorBody {
  error?: string;
}

// Fetches the field list for the selected object from the server's
// /api/objects/:objectName/fields route (built in an earlier task). Refetches
// whenever objectName changes, and ignores a stale response if the user
// switches objects again before the previous request finishes.
export function useObjectFields(objectName: string | null): {
  fields: SalesforceField[];
  status: ObjectFieldsStatus;
  error: string | null;
} {
  const [fields, setFields] = useState<SalesforceField[]>([]);
  const [status, setStatus] = useState<ObjectFieldsStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!objectName) {
      setFields([]);
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setError(null);

    fetch(`/api/objects/${objectName}/fields`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ErrorBody | null;
          throw new Error(body?.error ?? `Failed to load fields (${res.status}).`);
        }
        return res.json() as Promise<SalesforceField[]>;
      })
      .then((data) => {
        if (cancelled) return;
        setFields(data);
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load fields.");
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [objectName]);

  return { fields, status, error };
}
