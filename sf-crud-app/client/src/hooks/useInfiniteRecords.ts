import { useCallback, useEffect, useRef, useState } from "react";

const PAGE_SIZE = 20;

export interface SalesforceRecord {
  [field: string]: unknown;
}

interface RecordsResponse {
  totalSize: number;
  limit: number;
  offset: number;
  records: SalesforceRecord[];
}

interface ErrorBody {
  error?: string;
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ErrorBody | null;
  return body?.error ?? fallback;
}

// Paginated fetch against GET /api/records/:objectName. Call fetchMore() to
// load the next page (offset += 20); it no-ops while a fetch is already in
// flight or once the API has returned a short page (fewer than 20 = done).
// Selecting a different object or field set restarts from offset 0 and
// aborts any request still in flight for the old selection, so a slow
// response for "Account" can't land after the user already switched to
// "Contact" and silently corrupt the record list.
//
// createRecord/updateRecord/deleteRecord update the local `records` array
// directly on success instead of refetching the list — the task calls for
// refreshing only the affected row, not a full reload.
export function useInfiniteRecords(objectName: string, fields: string[]) {
  const [records, setRecords] = useState<SalesforceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Edit/Delete need the record Id regardless of whether the user chose to
  // display it as a column, so it's always requested even if not selected.
  const queryFields = fields.includes("Id") ? fields : ["Id", ...fields];
  const fieldsKey = queryFields.join(",");

  const fetchPage = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current || !abortRef.current) {
      return;
    }

    const { signal } = abortRef.current;
    loadingRef.current = true;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      fields: fieldsKey,
      limit: String(PAGE_SIZE),
      offset: String(offsetRef.current),
    });

    fetch(`/api/records/${objectName}?${params.toString()}`, {
      credentials: "include",
      signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(await parseErrorMessage(res, `Failed to load records (${res.status}).`));
        }
        return res.json() as Promise<RecordsResponse>;
      })
      .then((data) => {
        setRecords((prev) => [...prev, ...data.records]);
        offsetRef.current += data.records.length;
        const done = data.records.length < PAGE_SIZE;
        hasMoreRef.current = !done;
        setHasMore(!done);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        hasMoreRef.current = false;
        setHasMore(false);
        setError(err instanceof Error ? err.message : "Failed to load records.");
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [objectName, fieldsKey]);

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    offsetRef.current = 0;
    hasMoreRef.current = true;
    loadingRef.current = false;
    setRecords([]);
    setHasMore(true);
    setError(null);
    fetchPage();

    return () => {
      controller.abort();
    };
  }, [fetchPage]);

  const createRecord = useCallback(
    async (values: Record<string, unknown>): Promise<SalesforceRecord> => {
      const res = await fetch(`/api/records/${objectName}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, `Failed to create record (${res.status}).`));
      }
      const data = (await res.json()) as { id: string };
      // The create endpoint only returns the new Id, not the full record —
      // reconstructing it from what was just submitted avoids a second
      // round trip, at the cost of not reflecting server-side defaults for
      // fields that weren't part of the submitted (createable) set.
      const newRecord: SalesforceRecord = { Id: data.id, ...values };
      setRecords((prev) => [newRecord, ...prev]);
      return newRecord;
    },
    [objectName],
  );

  const updateRecord = useCallback(
    async (id: string, values: Record<string, unknown>): Promise<void> => {
      const res = await fetch(`/api/records/${objectName}/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, `Failed to update record (${res.status}).`));
      }
      setRecords((prev) =>
        prev.map((record) => (record.Id === id ? { ...record, ...values } : record)),
      );
    },
    [objectName],
  );

  const deleteRecord = useCallback(
    async (id: string): Promise<void> => {
      const res = await fetch(`/api/records/${objectName}/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error(await parseErrorMessage(res, `Failed to delete record (${res.status}).`));
      }
      setRecords((prev) => prev.filter((record) => record.Id !== id));
    },
    [objectName],
  );

  return {
    records,
    loading,
    hasMore,
    error,
    fetchMore: fetchPage,
    createRecord,
    updateRecord,
    deleteRecord,
  };
}
