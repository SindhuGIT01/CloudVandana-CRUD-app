interface RecordsTableProps {
  objectName: string;
  fields: string[];
}

// Placeholder — a later task wires this up to GET /api/records/:objectName
// and renders the actual paginated table. For now it just confirms the
// object + field selection from FieldPicker is flowing down correctly.
export function RecordsTable({ objectName, fields }: RecordsTableProps) {
  return (
    <section className="records-table-placeholder">
      <p>
        Ready to load <strong>{objectName}</strong> records with fields: {fields.join(", ")}
      </p>
    </section>
  );
}
