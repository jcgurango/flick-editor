import type { FlickObject } from '../types/project'
import { computeBBox, absoluteOrigin } from '../lib/bbox'

interface SvgObjectProps {
  obj: FlickObject
  onClick?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
}

/** Renders a FlickObject as the corresponding SVG element. */
export function SvgObject({ obj, onClick, onMouseDown }: SvgObjectProps) {
  const { type, id } = obj

  // Extract non-SVG attrs
  const {
    rotation,
    ...restAttrs
  } = obj.attrs as Record<string, unknown> & {
    rotation?: number
  }

  // Build transform chain (applied in SVG order: leftmost = outermost)
  const transforms: string[] = []

  // Rotation with percentage-based origin (outermost - applied last to geometry)
  const rot = rotation as number | undefined
  if (rot != null && rot !== 0) {
    const bbox = computeBBox(obj)
    if (bbox) {
      const [absOx, absOy] = absoluteOrigin(obj, bbox)
      transforms.push(`rotate(${rot}, ${absOx}, ${absOy})`)
    }
  }

  // For paths, x/y is position (rendered as translate), not a native SVG attr
  let svgAttrs: Record<string, unknown> = restAttrs
  if (type === 'path') {
    const { x, y, ...pathAttrs } = restAttrs as Record<string, unknown> & { x?: number; y?: number }
    svgAttrs = pathAttrs
    const px = (x as number) ?? 0
    const py = (y as number) ?? 0
    if (px || py) {
      transforms.push(`translate(${px}, ${py})`)
    }
  }

  const transform = transforms.length > 0 ? transforms.join(' ') : undefined

  const interactive = { onClick, onMouseDown, style: { cursor: 'pointer' as const }, pointerEvents: 'all' as const }

  const element = (() => {
    switch (type) {
      case 'rect':
        return <rect data-id={id} {...svgAttrs} {...interactive} />
      case 'ellipse':
        return <ellipse data-id={id} {...svgAttrs} {...interactive} />
      case 'circle':
        return <circle data-id={id} {...svgAttrs} {...interactive} />
      case 'line':
        return <line data-id={id} {...svgAttrs} {...interactive} />
      case 'path':
        return <path data-id={id} {...svgAttrs} {...interactive} />
      case 'text':
        return (
          <text data-id={id} {...svgAttrs} {...interactive}>
            {svgAttrs.text as string}
          </text>
        )
      default:
        return null
    }
  })()

  if (!element) return null

  return transform ? <g transform={transform}>{element}</g> : element
}
