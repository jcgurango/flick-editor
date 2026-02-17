import { createContext, useContext } from 'react'
import type { FlickObject, Project, Layer } from '../types/project'
import { computeBBox, absoluteOrigin } from '../lib/bbox'
import { resolveClipFrame, resolveClipObjects } from '../lib/interpolate'

/** Context for resolving clip instances during rendering. */
export interface ClipRenderContextValue {
  project: Project
  parentLayer: Layer
  parentFrame: number
  /** Track visited clip IDs to detect circular dependencies. */
  visitedClipIds?: Set<string>
}

export const ClipRenderContext = createContext<ClipRenderContextValue | null>(null)

interface SvgObjectProps {
  obj: FlickObject
  onClick?: (e: React.MouseEvent) => void
  onMouseDown?: (e: React.MouseEvent) => void
  onDoubleClick?: (e: React.MouseEvent) => void
}

/** Renders a FlickObject as the corresponding SVG element. */
export function SvgObject({ obj, onClick, onMouseDown, onDoubleClick }: SvgObjectProps) {
  const { type, id } = obj
  const clipCtx = useContext(ClipRenderContext)

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

  // For paths, groups, and clips, x/y is position (rendered as translate)
  let svgAttrs: Record<string, unknown> = restAttrs
  if (type === 'path' || type === 'group' || type === 'clip') {
    const { x, y, children: _children, scaleX: _sx, scaleY: _sy, clipId: _cid, setFrame: _sf, ...otherAttrs } = restAttrs as Record<string, unknown> & { x?: number; y?: number; children?: unknown; scaleX?: number; scaleY?: number; clipId?: string; setFrame?: number }
    svgAttrs = otherAttrs
    const px = (x as number) ?? 0
    const py = (y as number) ?? 0
    if (px || py) {
      transforms.push(`translate(${px}, ${py})`)
    }
    // Group/clip scale (applied innermost — scales children around origin)
    if (type === 'group' || type === 'clip') {
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

  // Clip rendering — resolve clip contents and render as <g>
  if (type === 'clip' && clipCtx) {
    const clipId = obj.attrs.clipId as string | undefined
    if (!clipId) return null

    // Circular dependency check
    const visited = clipCtx.visitedClipIds ?? new Set<string>()
    if (visited.has(clipId)) return null

    const clipDef = clipCtx.project.clips.find(c => c.id === clipId)
    if (!clipDef) return null

    const clipFrame = resolveClipFrame(clipDef, clipCtx.parentLayer, id, clipCtx.parentFrame)
    const clipObjects = resolveClipObjects(clipDef, clipFrame)

    // Provide nested context for clips-inside-clips, tracking visited for cycle detection
    const nestedVisited = new Set(visited)
    nestedVisited.add(clipId)
    const nestedCtx: ClipRenderContextValue = {
      project: clipCtx.project,
      parentLayer: clipDef.layers[0] ?? clipCtx.parentLayer,
      parentFrame: clipFrame,
      visitedClipIds: nestedVisited,
    }

    return (
      <ClipRenderContext.Provider value={nestedCtx}>
        <g data-id={id} transform={transform} {...interactive}>
          {clipObjects.map(child => (
            <SvgObject key={child.id} obj={child} />
          ))}
        </g>
      </ClipRenderContext.Provider>
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
      case 'clip':
        // No clip context available — render nothing
        return null
      default:
        return null
    }
  })()

  if (!element) return null

  return transform ? <g transform={transform}>{element}</g> : element
}
