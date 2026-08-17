import { useState } from "react";
import type { FormEvent } from "react";
import type { SalesforceRecord } from "../hooks/useInfiniteRecords";
import type { SalesforceField } from "../hooks/useObjectFields";
import { Modal } from "./Modal";

interface RecordFormModalProps {
  mode: "create" | "edit";
  objectName: string;
  fields: SalesforceField[];
  initialValues?: SalesforceRecord;
  onClose: () => void;
  onSubmit: (values: Record<string, unknown>) => Promise<void>;
}

const NUMERIC_TYPES = new Set(["int", "double", "currency", "percent"]);

function inputTypeFor(field: SalesforceField): string {
  switch (field.type) {
    case "boolean":
      return "checkbox";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "email":
      return "email";
    default:
      return NUMERIC_TYPES.has(field.type) ? "number" : "text";
  }
}

function toFormValue(field: SalesforceField, raw: unknown): string | boolean {
  if (field.type === "boolean") return Boolean(raw);
  if (raw === null || raw === undefined) return "";
  if (field.type === "datetime" && typeof raw === "string") {
    // Salesforce returns e.g. "2024-01-15T10:30:00.000+0000"; a
    // datetime-local input needs "YYYY-MM-DDTHH:mm" — close enough for
    // editing, at the cost of dropping the timezone offset on display.
    return raw.slice(0, 16);
  }
  return String(raw);
}

function coerceValue(field: SalesforceField, raw: string | boolean): unknown {
  if (field.type === "boolean") return Boolean(raw);
  if (typeof raw === "string" && raw.trim() === "") return null;
  if (NUMERIC_TYPES.has(field.type)) {
    const num = Number(raw);
    return Number.isNaN(num) ? null : num;
  }
  return raw;
}

export function RecordFormModal({
  mode,
  objectName,
  fields,
  initialValues,
  onClose,
  onSubmit,
}: RecordFormModalProps) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    for (const field of fields) {
      initial[field.name] = toFormValue(field, initialValues?.[field.name]);
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditable = (field: SalesforceField) =>
    mode === "create" ? field.createable : field.updateable;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);

    const submitValues: Record<string, unknown> = {};
    for (const field of fields) {
      if (!isEditable(field)) continue;
      const coerced = coerceValue(field, values[field.name]);
      // On create, leave untouched fields out entirely so Salesforce applies
      // its own defaults instead of us sending an explicit blank/zero.
      if (mode === "create" && coerced === null) continue;
      submitValues[field.name] = coerced;
    }

    try {
      await onSubmit(submitValues);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title={mode === "create" ? `New ${objectName}` : `Edit ${objectName}`} onClose={onClose}>
      <form className="record-form" onSubmit={handleSubmit}>
        {fields.map((field) => {
          const editable = isEditable(field);
          const inputType = inputTypeFor(field);
          const value = values[field.name];

          return (
            <label key={field.name} className="record-form-field">
              <span>
                {field.label}
                {!editable && <span className="record-form-readonly"> (read-only)</span>}
              </span>
              {inputType === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  disabled={!editable}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.checked }))
                  }
                />
              ) : field.type === "textarea" ? (
                <textarea
                  value={String(value)}
                  disabled={!editable}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
              ) : (
                <input
                  type={inputType}
                  value={String(value)}
                  disabled={!editable}
                  onChange={(event) =>
                    setValues((prev) => ({ ...prev, [field.name]: event.target.value }))
                  }
                />
              )}
            </label>
          );
        })}

        {formError && (
          <p role="alert" className="record-form-error">
            {formError}
          </p>
        )}

        <div className="record-form-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
