import { SALESFORCE_OBJECTS } from "../constants";

interface ObjectSelectorProps {
  value: string;
  onChange: (objectName: string) => void;
}

export function ObjectSelector({ value, onChange }: ObjectSelectorProps) {
  return (
    <label className="object-selector">
      Salesforce object
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          Select an object…
        </option>
        {SALESFORCE_OBJECTS.map((objectName) => (
          <option key={objectName} value={objectName}>
            {objectName}
          </option>
        ))}
      </select>
    </label>
  );
}
