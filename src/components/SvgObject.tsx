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
    rotation, originX: _ox, originY: _oy,
    translateX, translateY,
    scaleX, scaleY,
    ...svgAttrs
  } = obj.attrs as Record<string, unknown> & {
    rotation?: number
    originX?: number
    originY?: number
    translateX?: number
    translateY?: number
    scaleX?: number
    scaleY?: number
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

  // Translation
  if (translateX || translateY) {
    transforms.push(`translate(${translateX ?? 0}, ${translateY ?? 0})`)
  }

  // Scale (for paths)
  const sx = scaleX as number | undefined
  const sy = scaleY as number | undefined
  if (sx != null && sy != null && (sx !== 1 || sy !== 1)) {
    transforms.push(`scale(${sx}, ${sy})`)
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
