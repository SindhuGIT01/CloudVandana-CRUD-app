import { useEffect, useRef } from "react";
import { useInfiniteRecords, type SalesforceRecord } from "../hooks/useInfiniteRecords";

interface RecordsTableProps {
  objectName: string;
  fields: string[];
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// Salesforce record ids are only present if "Id" happens to be one of the
// user-picked fields — it isn't guaranteed. Falling back to row position is
// safe here since records are only ever appended, never reordered.
function rowKey(record: SalesforceRecord, index: number): string {
  const id = record.Id;
  return typeof id === "string" ? id : `row-${index}`;
}

export function RecordsTable({ objectName, fields }: RecordsTableProps) {
  const { records, loading, hasMore, error, fetchMore } = useInfiniteRecords(objectName, fields);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  // Continuously tracks the sentinel's current intersection state, not just
  // the edge transitions IntersectionObserver calls back on (see below).
  const isIntersectingRef = useRef(false);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    // fetchMore already no-ops while loading or once hasMore is false, so
    // it's safe to call on every intersection without extra guards here.
    const observer = new IntersectionObserver(
      (entries) => {
        isIntersectingRef.current = entries[0]?.isIntersecting ?? false;
        if (isIntersectingRef.current) {
          fetchMore();
        }
      },
      { rootMargin: "200px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetchMore]);

  // IntersectionObserver only fires on enter/exit transitions. If a page's
  // new rows don't push the sentinel fully out of view (e.g. on a tall
  // viewport, or a page that renders shorter than the observed margin), it
  // never registers a fresh "entering" transition and pagination silently
  // stalls even though the sentinel is still plainly on screen. Re-checking
  // once a fetch settles and continuing to drain pages while still visible
  // covers that gap.
  useEffect(() => {
    if (!loading && isIntersectingRef.current) {
      fetchMore();
    }
  }, [loading, fetchMore]);

  return (
    <section className="records-table-wrapper">
      <table className="records-table">
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field}>{field}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => (
            <tr key={rowKey(record, index)}>
              {fields.map((field) => (
                <td key={field}>{formatCellValue(record[field])}</td>
              ))}
            </tr>
          ))}
          <tr ref={sentinelRef}>
            <td colSpan={fields.length} className="records-table-sentinel">
              {loading && <span className="spinner" role="status" aria-label="Loading records" />}
              {!loading && error && <span role="alert">{error}</span>}
              {!loading && !error && !hasMore && records.length === 0 && (
                <span>No records found.</span>
              )}
              {!loading && !error && !hasMore && records.length > 0 && (
                <span>End of records.</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
