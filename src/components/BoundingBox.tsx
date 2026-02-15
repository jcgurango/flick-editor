import type { FlickObject } from '../types/project'
import { computeBBox, absoluteOrigin, rotatedCorners } from '../lib/bbox'

export type HandleId =
  | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'
  | 'edge-t' | 'edge-r' | 'edge-b' | 'edge-l'

interface BoundingBoxProps {
  obj: FlickObject
  zoom: number
  onHandleMouseDown?: (handle: HandleId, e: React.MouseEvent) => void
}

const HANDLE_SIZE = 8

export function BoundingBox({ obj, zoom, onHandleMouseDown }: BoundingBoxProps) {
  const bbox = computeBBox(obj)
  if (!bbox) return null

  const rotation = (obj.attrs.rotation as number) ?? 0
  const origin = absoluteOrigin(obj, bbox)
  const corners = rotatedCorners(bbox, rotation, origin)

  // Inverse scale for handles so they stay constant screen size
  const s = HANDLE_SIZE / zoom
  const strokeW = 1.5 / zoom

  // Corner midpoints for edge handles
  const midpoint = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]

  const edgeMids = {
    'edge-t': midpoint(corners[0], corners[1]),
    'edge-r': midpoint(corners[1], corners[2]),
    'edge-b': midpoint(corners[2], corners[3]),
    'edge-l': midpoint(corners[3], corners[0]),
  }

  const cornerHandles: { id: HandleId; pos: [number, number]; cursor: string }[] = [
    { id: 'corner-tl', pos: corners[0], cursor: 'nwse-resize' },
    { id: 'corner-tr', pos: corners[1], cursor: 'nesw-resize' },
    { id: 'corner-br', pos: corners[2], cursor: 'nwse-resize' },
    { id: 'corner-bl', pos: corners[3], cursor: 'nesw-resize' },
  ]

  const edgeHandles: { id: HandleId; pos: [number, number]; cursor: string }[] = [
    { id: 'edge-t', pos: edgeMids['edge-t'], cursor: 'ns-resize' },
    { id: 'edge-r', pos: edgeMids['edge-r'], cursor: 'ew-resize' },
    { id: 'edge-b', pos: edgeMids['edge-b'], cursor: 'ns-resize' },
    { id: 'edge-l', pos: edgeMids['edge-l'], cursor: 'ew-resize' },
  ]

  const allHandles = [...cornerHandles, ...edgeHandles]

  // Build outline path from corners
  const outlinePath = `M${corners[0][0]},${corners[0][1]} L${corners[1][0]},${corners[1][1]} L${corners[2][0]},${corners[2][1]} L${corners[3][0]},${corners[3][1]} Z`

  return (
    <g className="bounding-box">
      {/* Outline */}
      <path
        d={outlinePath}
        fill="none"
        stroke="#4a7aff"
        strokeWidth={strokeW}
        pointerEvents="none"
      />

      {/* Handles */}
      {allHandles.map((h) => (
        <rect
          key={h.id}
          x={h.pos[0] - s / 2}
          y={h.pos[1] - s / 2}
          width={s}
          height={s}
          fill="white"
          stroke="#4a7aff"
          strokeWidth={strokeW}
          style={{ cursor: h.cursor }}
          onMouseDown={(e) => {
            e.stopPropagation()
            onHandleMouseDown?.(h.id, e)
          }}
        />
      ))}
    </g>
  )
}
