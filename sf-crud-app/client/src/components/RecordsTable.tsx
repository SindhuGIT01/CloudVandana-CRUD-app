import { useEffect, useRef, useState } from "react";
import { useInfiniteRecords, type SalesforceRecord } from "../hooks/useInfiniteRecords";
import type { SalesforceField } from "../hooks/useObjectFields";
import { useToasts } from "../hooks/useToasts";
import { RecordFormModal } from "./RecordFormModal";
import { StatusMessage } from "./StatusMessage";
import { ToastContainer } from "./ToastContainer";

interface RecordsTableProps {
  objectName: string;
  fields: SalesforceField[];
}

type ModalState = { mode: "create" } | { mode: "edit"; record: SalesforceRecord } | null;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function recordId(record: SalesforceRecord): string | undefined {
  return typeof record.Id === "string" ? record.Id : undefined;
}

export function RecordsTable({ objectName, fields }: RecordsTableProps) {
  const fieldNames = fields.map((field) => field.name);
  const { records, loading, hasMore, error, fetchMore, createRecord, updateRecord, deleteRecord } =
    useInfiniteRecords(objectName, fieldNames);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  // Continuously tracks the sentinel's current intersection state, not just
  // the edge transitions IntersectionObserver calls back on (see below).
  const isIntersectingRef = useRef(false);
  const { toasts, showToast } = useToasts();
  const [modalState, setModalState] = useState<ModalState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const handleCreateSubmit = async (values: Record<string, unknown>) => {
    try {
      await createRecord(values);
      setModalState(null);
      showToast(`${objectName} created.`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to create ${objectName}.`;
      showToast(message, "error");
      // Re-throw so the modal shows the inline error too and stays open for retry.
      throw err;
    }
  };

  const handleEditSubmit = async (id: string, values: Record<string, unknown>) => {
    try {
      await updateRecord(id, values);
      setModalState(null);
      showToast(`${objectName} updated.`, "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : `Failed to update ${objectName}.`;
      showToast(message, "error");
      throw err;
    }
  };

  const handleDelete = async (record: SalesforceRecord) => {
    const id = recordId(record);
    if (!id) return;
    if (!window.confirm(`Delete this ${objectName} record? This can't be undone.`)) return;

    setDeletingId(id);
    try {
      await deleteRecord(id);
      showToast(`${objectName} deleted.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : `Failed to delete ${objectName}.`, "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="records-table-panel">
      <div className="records-table-toolbar">
        <button
          type="button"
          className="primary-button"
          onClick={() => setModalState({ mode: "create" })}
        >
          New Record
        </button>
      </div>

      <div className="records-table-wrapper">
        <table className="records-table">
          <thead>
            <tr>
              {fields.map((field) => (
                <th key={field.name}>{field.label}</th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => {
              const id = recordId(record);
              return (
                <tr key={id ?? `row-${index}`}>
                  {fields.map((field) => (
                    <td key={field.name}>{formatCellValue(record[field.name])}</td>
                  ))}
                  <td className="records-table-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setModalState({ mode: "edit", record })}
                      disabled={!id}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button link-button-danger"
                      onClick={() => handleDelete(record)}
                      disabled={!id || deletingId === id}
                    >
                      {deletingId === id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr ref={sentinelRef}>
              <td colSpan={fields.length + 1} className="records-table-sentinel">
                {loading && <StatusMessage variant="loading" message="Loading records…" />}
                {!loading && error && <StatusMessage variant="error" message={error} />}
                {!loading && !error && !hasMore && records.length === 0 && (
                  <StatusMessage variant="empty" message="No records found." />
                )}
                {!loading && !error && !hasMore && records.length > 0 && (
                  <StatusMessage variant="empty" message="End of records." />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {modalState?.mode === "create" && (
        <RecordFormModal
          mode="create"
          objectName={objectName}
          fields={fields}
          onClose={() => setModalState(null)}
          onSubmit={handleCreateSubmit}
        />
      )}

      {modalState?.mode === "edit" && recordId(modalState.record) && (
        <RecordFormModal
          mode="edit"
          objectName={objectName}
          fields={fields}
          initialValues={modalState.record}
          onClose={() => setModalState(null)}
          onSubmit={(values) => handleEditSubmit(recordId(modalState.record) as string, values)}
        />
      )}

      <ToastContainer toasts={toasts} />
    </section>
  );
}
