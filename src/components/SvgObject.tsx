import type { FlickObject } from '../types/project'
import { computeBBox, absoluteOrigin } from '../lib/bbox'

interface SvgObjectProps {
  obj: FlickObject
  onClick?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
}

/** Renders a FlickObject as the corresponding SVG element. */
export function SvgObject({ obj, onClick, onMouseDown, onDoubleClick }: SvgObjectProps) {
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

  // For paths and groups, x/y is position (rendered as translate)
  let svgAttrs: Record<string, unknown> = restAttrs
  if (type === 'path' || type === 'group') {
    const { x, y, children: _children, scaleX: _sx, scaleY: _sy, ...otherAttrs } = restAttrs as Record<string, unknown> & { x?: number; y?: number; children?: unknown; scaleX?: number; scaleY?: number }
    svgAttrs = otherAttrs
    const px = (x as number) ?? 0
    const py = (y as number) ?? 0
    if (px || py) {
      transforms.push(`translate(${px}, ${py})`)
    }
    // Group scale (applied innermost — scales children around origin)
    if (type === 'group') {
      const sx = (obj.attrs.scaleX as number) ?? 1
      const sy = (obj.attrs.scaleY as number) ?? 1
      if (sx !== 1 || sy !== 1) {
        transforms.push(`scale(${sx}, ${sy})`)
      }
    }
  }

  const transform = transforms.length > 0 ? transforms.join(' ') : undefined

  const interactive = { onClick, onMouseDown, onDoubleClick, style: { cursor: 'pointer' as const }, pointerEvents: 'all' as const }

  // Group rendering — single <g> with transform + interactive props
  if (type === 'group') {
    const children = (obj.attrs.children as FlickObject[]) ?? []
    return (
      <g data-id={id} transform={transform} {...interactive}>
        {children.map(child => (
          <SvgObject key={child.id} obj={child} />
        ))}
      </g>
    )
  }

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
