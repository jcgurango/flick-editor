import type { FlickObject } from '../types/project'

/** Renders a FlickObject as the corresponding SVG element. */
export function SvgObject({ obj }: { obj: FlickObject }) {
  const { type, attrs, id } = obj

  switch (type) {
    case 'rect':
      return <rect data-id={id} {...attrs} />
    case 'ellipse':
      return <ellipse data-id={id} {...attrs} />
    case 'circle':
      return <circle data-id={id} {...attrs} />
    case 'line':
      return <line data-id={id} {...attrs} />
    case 'path':
      return <path data-id={id} {...attrs} />
    case 'text':
      return (
        <text data-id={id} {...attrs}>
          {attrs.text as string}
        </text>
      )
    default:
      return null
  }
}
