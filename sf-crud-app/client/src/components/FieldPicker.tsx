import { MAX_SELECTED_FIELDS, MIN_SELECTED_FIELDS } from "../constants";
import type { SalesforceField } from "../hooks/useObjectFields";

interface FieldPickerProps {
  fields: SalesforceField[];
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function FieldPicker({ fields, selected, onChange }: FieldPickerProps) {
  const atMax = selected.length >= MAX_SELECTED_FIELDS;
  const belowMin = selected.length < MIN_SELECTED_FIELDS;

  const toggle = (fieldName: string, checked: boolean) => {
    if (checked) {
      // Belt-and-braces: the checkbox is already disabled once atMax, but
      // guard here too in case this ever gets called some other way.
      if (atMax) return;
      onChange([...selected, fieldName]);
    } else {
      onChange(selected.filter((name) => name !== fieldName));
    }
  };

  return (
    <fieldset className="field-picker">
      <legend>
        Choose {MIN_SELECTED_FIELDS}–{MAX_SELECTED_FIELDS} fields ({selected.length} selected)
      </legend>
      <div className="field-picker-grid">
        {fields.map((field) => {
          const checked = selected.includes(field.name);
          return (
            <label key={field.name} className="field-picker-option">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && atMax}
                onChange={(event) => toggle(field.name, event.target.checked)}
              />
              {field.label} <code>{field.name}</code>
            </label>
          );
        })}
      </div>
      {belowMin && (
        <p role="alert" className="field-picker-message">
          Select at least {MIN_SELECTED_FIELDS} fields ({MIN_SELECTED_FIELDS - selected.length} more needed).
        </p>
      )}
      {atMax && <p className="field-picker-message">Maximum of {MAX_SELECTED_FIELDS} fields reached.</p>}
    </fieldset>
  );
}
