import { useState } from "react";
import { FieldPicker } from "../components/FieldPicker";
import { ObjectSelector } from "../components/ObjectSelector";
import { RecordsTable } from "../components/RecordsTable";
import { MAX_SELECTED_FIELDS, MIN_SELECTED_FIELDS } from "../constants";
import { useObjectFields } from "../hooks/useObjectFields";

export function Dashboard() {
  const [selectedObject, setSelectedObject] = useState("");
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const { fields, status, error } = useObjectFields(selectedObject || null);

  const handleObjectChange = (objectName: string) => {
    setSelectedObject(objectName);
    // Field choices only make sense for the object they were picked from.
    setSelectedFields([]);
  };

  const fieldsValid =
    selectedFields.length >= MIN_SELECTED_FIELDS && selectedFields.length <= MAX_SELECTED_FIELDS;

  // RecordsTable needs full field metadata (createable/updateable/type), not
  // just names, to build the Create/Edit forms — mapped in selection order
  // so table columns match the order fields were checked in.
  const selectedFieldMeta = selectedFields
    .map((name) => fields.find((field) => field.name === name))
    .filter((field): field is (typeof fields)[number] => field !== undefined);

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            window.location.href = "/auth/logout";
          }}
        >
          Log out
        </button>
      </div>

      <ObjectSelector value={selectedObject} onChange={handleObjectChange} />

      {status === "loading" && <p>Loading fields…</p>}
      {status === "error" && <p role="alert">{error}</p>}

      {status === "ready" && (
        <FieldPicker fields={fields} selected={selectedFields} onChange={setSelectedFields} />
      )}

      {fieldsValid && <RecordsTable objectName={selectedObject} fields={selectedFieldMeta} />}
    </main>
  );
}
