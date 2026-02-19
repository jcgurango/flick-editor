export type FieldType = 'number' | 'color' | 'text' | 'select'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  min?: number
  max?: number
  step?: number
  options?: { value: string; label: string }[]
}

const POSITION_FIELDS: FieldDef[] = [
  { key: 'x', label: 'X', type: 'number' },
  { key: 'y', label: 'Y', type: 'number' },
]

const STYLE_FIELDS: FieldDef[] = [
  { key: 'fill', label: 'Fill', type: 'color' },
  { key: 'stroke', label: 'Stroke', type: 'color' },
  { key: 'strokeWidth', label: 'Stroke W', type: 'number', min: 0 },
  { key: 'paintOrder', label: 'Paint Order', type: 'select', options: [
    { value: 'normal', label: 'Normal' },
    { value: 'stroke', label: 'Stroke first' },
  ]},
]

const ROTATION_FIELD: FieldDef = { key: 'rotation', label: 'Rotation', type: 'number' }

export const OBJECT_FIELDS: Record<string, FieldDef[]> = {
  rect: [
    ...POSITION_FIELDS,
    { key: 'width', label: 'Width', type: 'number', min: 0 },
    { key: 'height', label: 'Height', type: 'number', min: 0 },
    { key: 'rx', label: 'Radius', type: 'number', min: 0 },
    ROTATION_FIELD,

    ...STYLE_FIELDS,
  ],
  circle: [
    { key: 'cx', label: 'X', type: 'number' },
    { key: 'cy', label: 'Y', type: 'number' },
    { key: 'r', label: 'Radius', type: 'number', min: 0 },
    ROTATION_FIELD,

    ...STYLE_FIELDS,
  ],
  ellipse: [
    { key: 'cx', label: 'X', type: 'number' },
    { key: 'cy', label: 'Y', type: 'number' },
    { key: 'rx', label: 'Radius X', type: 'number', min: 0 },
    { key: 'ry', label: 'Radius Y', type: 'number', min: 0 },
    ROTATION_FIELD,

    ...STYLE_FIELDS,
  ],
  line: [
    { key: 'x1', label: 'X1', type: 'number' },
    { key: 'y1', label: 'Y1', type: 'number' },
    { key: 'x2', label: 'X2', type: 'number' },
    { key: 'y2', label: 'Y2', type: 'number' },
    ...STYLE_FIELDS,
  ],
  path: [
    ...POSITION_FIELDS,
    ROTATION_FIELD,

    ...STYLE_FIELDS,
  ],
  group: [
    ...POSITION_FIELDS,
    ROTATION_FIELD,
    { key: 'scaleX', label: 'Scale X', type: 'number', step: 0.1 },
    { key: 'scaleY', label: 'Scale Y', type: 'number', step: 0.1 },
  ],
  clip: [
    ...POSITION_FIELDS,
    ROTATION_FIELD,
    { key: 'scaleX', label: 'Scale X', type: 'number', step: 0.1 },
    { key: 'scaleY', label: 'Scale Y', type: 'number', step: 0.1 },
    { key: 'setFrame', label: 'Set Frame', type: 'number', min: 1 },
  ],
}

export const TYPE_NAMES: Record<string, string> = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  line: 'Line',
  path: 'Path',
  text: 'Text',
  group: 'Group',
  clip: 'Clip',
}
