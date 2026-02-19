import type { FieldDef } from '../lib/inspector-schema'

interface InspectorFieldProps {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
}

export function InspectorField({ field, value, onChange }: InspectorFieldProps) {
  switch (field.type) {
    case 'number':
      return (
        <div className="inspector-row">
          <span className="inspector-label">{field.label}</span>
          <input
            className="inspector-input"
            type="number"
            value={value != null ? Number(value) : ''}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      )

    case 'color':
      return (
        <div className="inspector-row">
          <span className="inspector-label">{field.label}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="color"
              value={typeof value === 'string' ? value : '#000000'}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 22, height: 22, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
            />
            <input
              className="inspector-input"
              type="text"
              value={typeof value === 'string' ? value : ''}
              onChange={(e) => onChange(e.target.value)}
              style={{ width: 62 }}
            />
          </div>
        </div>
      )

    case 'text':
      return (
        <div className="inspector-row">
          <span className="inspector-label">{field.label}</span>
          <input
            className="inspector-input"
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      )

    case 'select':
      return (
        <div className="inspector-row">
          <span className="inspector-label">{field.label}</span>
          <select
            className="inspector-input"
            value={typeof value === 'string' ? value : field.options?.[0]?.value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )
  }
}
