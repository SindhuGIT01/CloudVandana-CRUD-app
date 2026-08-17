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

// Paginated fetch against GET /api/records/:objectName. Call fetchMore() to
// load the next page (offset += 20); it no-ops while a fetch is already in
// flight or once the API has returned a short page (fewer than 20 = done).
// Selecting a different object or field set restarts from offset 0 and
// aborts any request still in flight for the old selection, so a slow
// response for "Account" can't land after the user already switched to
// "Contact" and silently corrupt the record list.
export function useInfiniteRecords(objectName: string, fields: string[]) {
  const [records, setRecords] = useState<SalesforceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const fieldsKey = fields.join(",");

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
          const body = (await res.json().catch(() => null)) as ErrorBody | null;
          throw new Error(body?.error ?? `Failed to load records (${res.status}).`);
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

  return { records, loading, hasMore, error, fetchMore: fetchPage };
}
