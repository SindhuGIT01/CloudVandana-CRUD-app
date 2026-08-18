import { useState } from "react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { FieldPicker } from "../components/FieldPicker";
import { Header } from "../components/Header";
import { ObjectSelector } from "../components/ObjectSelector";
import { RecordsTable } from "../components/RecordsTable";
import { StatusMessage } from "../components/StatusMessage";
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
      <Header title="Dashboard" showLogout />

      <ObjectSelector value={selectedObject} onChange={handleObjectChange} />

      {status === "loading" && <StatusMessage variant="loading" message="Loading fields…" />}
      {status === "error" && <StatusMessage variant="error" message={error ?? "Failed to load fields."} />}

      {status === "ready" && (
        <FieldPicker fields={fields} selected={selectedFields} onChange={setSelectedFields} />
      )}

      {fieldsValid && (
        // Keying on the selection means picking a different object/field
        // set remounts a fresh boundary, so a prior crash doesn't get stuck
        // showing the fallback forever after the user changes their input.
        <ErrorBoundary label="the records table" key={`${selectedObject}-${selectedFields.join(",")}`}>
          <RecordsTable objectName={selectedObject} fields={selectedFieldMeta} />
        </ErrorBoundary>
      )}
    </main>
  );
}
