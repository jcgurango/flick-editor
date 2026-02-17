import type { BBox } from './bbox'
import { pathIntrinsicBBox, computeBBox } from './bbox'
import type { FlickObject } from '../types/project'

type HandleId =
  | 'corner-tl' | 'corner-tr' | 'corner-bl' | 'corner-br'
  | 'edge-t' | 'edge-r' | 'edge-b' | 'edge-l'

/** Compute new position attrs after translating an object by (dx, dy). */
export function dragAttrs(
  type: string,
  attrs: Record<string, unknown>,
  dx: number,
  dy: number,
): Record<string, unknown> {
  switch (type) {
    case 'rect':
      return {
        x: (attrs.x as number ?? 0) + dx,
        y: (attrs.y as number ?? 0) + dy,
      }
    case 'circle':
    case 'ellipse':
      return {
        cx: (attrs.cx as number ?? 0) + dx,
        cy: (attrs.cy as number ?? 0) + dy,
      }
    case 'line':
      return {
        x1: (attrs.x1 as number ?? 0) + dx,
        y1: (attrs.y1 as number ?? 0) + dy,
        x2: (attrs.x2 as number ?? 0) + dx,
        y2: (attrs.y2 as number ?? 0) + dy,
      }
    case 'path':
    case 'group':
    case 'clip':
      return {
        x: (attrs.x as number ?? 0) + dx,
        y: (attrs.y as number ?? 0) + dy,
      }
    default:
      return {}
  }
}

// ── Rotation ──

/**
 * Compute new attrs after rotating an object to `newRotation` degrees,
 * keeping `pivotWorld` fixed in world/canvas space.
 *
 * When the pivot is not the object's defined origin, position is adjusted
 * so the pivot visually stays in place.
 */
export function computeRotationAttrs(
  type: string,
  attrs: Record<string, unknown>,
  bbox: BBox,
  pivotWorld: [number, number],
  newRotation: number,
): Record<string, unknown> {
  const oldRotation = (attrs.rotation as number) ?? 0

  // Take the shortest path: adjust newRotation so the delta is in [-180, 180]
  let delta = newRotation - oldRotation
  delta = ((delta % 360) + 540) % 360 - 180
  newRotation = oldRotation + delta

  // Object's rotation origin: groups/clips use (x, y), others use bbox center
  let oX: number, oY: number
  if (type === 'group' || type === 'clip') {
    oX = (attrs.x as number) ?? 0
    oY = (attrs.y as number) ?? 0
  } else {
    oX = bbox.x + bbox.width * 0.5
    oY = bbox.y + bbox.height * 0.5
  }

  // Pivot's world-space offset from origin
  const pDx = pivotWorld[0] - oX
  const pDy = pivotWorld[1] - oY

  // Unrotate pivot to get its local-space offset from origin
  const oldRad = (oldRotation * Math.PI) / 180
  const cosOld = Math.cos(oldRad), sinOld = Math.sin(oldRad)
  const pRelX = cosOld * pDx + sinOld * pDy
  const pRelY = -sinOld * pDx + cosOld * pDy

  // Re-rotate with new angle
  const newRad = (newRotation * Math.PI) / 180
  const cosNew = Math.cos(newRad), sinNew = Math.sin(newRad)
  const newRotPx = cosNew * pRelX - sinNew * pRelY
  const newRotPy = sinNew * pRelX + cosNew * pRelY

  // Origin displacement = R(θ)*d - R(θ')*d
  const posDx = pDx - newRotPx
  const posDy = pDy - newRotPy

  const posAttrs = dragAttrs(type, attrs, posDx, posDy)
  return { ...posAttrs, rotation: newRotation }
}

// ── Scaling ──

/**
 * Compute new object attributes after a scale handle drag.
 *
 * The math:
 * 1. Convert mouse delta from canvas space to object-local space (undo rotation)
 * 2. Compute new width/height from the local delta
 * 3. Determine anchor point (opposite corner/edge or origin)
 * 4. Compute the anchor's world position (pre-rotation) so we can keep it fixed
 * 5. Solve for new position (x,y) that keeps anchor at same world position
 *
 * Modifiers:
 * - Default: non-uniform, anchor = opposite corner/edge
 * - Shift: anchor = origin (both sides move)
 * - Ctrl: uniform scaling (aspect ratio preserved)
 */
export function computeScale(
  type: string,
  attrs: Record<string, unknown>,
  bbox: BBox,
  handle: HandleId,
  dx: number,
  dy: number,
  rotation: number,
  shiftKey: boolean,
  ctrlKey: boolean,
  clipDimensions?: Map<string, BBox>,
): Record<string, unknown> {
  if (bbox.width === 0 && bbox.height === 0) return {}

  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)

  // 1. Rotate canvas-space delta into object-local space
  const ldx = cos * dx + sin * dy
  const ldy = -sin * dx + cos * dy

  // 2. Determine which axes are affected and direction of growth
  // Split on '-' to get position part ('tl','tr','bl','br','t','r','b','l')
  // so we don't match 'r' in the word "corner"
  const pos = handle.split('-')[1]
  const growsRight = pos.includes('r')
  const growsLeft = pos.includes('l')
  const growsDown = pos.includes('b')
  const growsUp = pos.includes('t')

  const affectsX = growsRight || growsLeft
  const affectsY = growsDown || growsUp

  // Size delta in local space
  let dw = 0, dh = 0
  if (affectsX) dw = (growsRight ? 1 : -1) * ldx
  if (affectsY) dh = (growsDown ? 1 : -1) * ldy

  // Shift: origin anchor means both sides move, so double the size change
  if (shiftKey) {
    dw *= 2
    dh *= 2
  }

  // Ctrl: uniform scaling - same scale factor on both axes
  if (ctrlKey && affectsX && affectsY) {
    const sx = bbox.width > 0 ? (bbox.width + dw) / bbox.width : 1
    const sy = bbox.height > 0 ? (bbox.height + dh) / bbox.height : 1
    // Use the axis with the larger change
    const uniformScale = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy
    dw = bbox.width * (uniformScale - 1)
    dh = bbox.height * (uniformScale - 1)
  } else if (ctrlKey && affectsX) {
    // Edge handle with ctrl: apply same factor to both axes
    const sx = bbox.width > 0 ? (bbox.width + dw) / bbox.width : 1
    dh = bbox.height * (sx - 1)
  } else if (ctrlKey && affectsY) {
    const sy = bbox.height > 0 ? (bbox.height + dh) / bbox.height : 1
    dw = bbox.width * (sy - 1)
  }

  const newW = Math.max(1, bbox.width + dw)
  const newH = Math.max(1, bbox.height + dh)

  // 3. Determine anchor point as a fraction of the bbox (0-1)
  let anchorFracX: number, anchorFracY: number

  if (shiftKey) {
    // Anchor = center
    anchorFracX = 0.5
    anchorFracY = 0.5
  } else {
    // Anchor = opposite side
    // If dragging right, anchor left (0). If dragging left, anchor right (1). If edge (no L/R), anchor center (0.5).
    anchorFracX = growsRight ? 0 : growsLeft ? 1 : 0.5
    anchorFracY = growsDown ? 0 : growsUp ? 1 : 0.5
  }

  // 4. Compute anchor's world position using OLD bbox
  // Origin is always at center (0.5, 0.5)
  const oldOriginX = bbox.x + bbox.width * 0.5
  const oldOriginY = bbox.y + bbox.height * 0.5
  const oldAnchorX = bbox.x + bbox.width * anchorFracX
  const oldAnchorY = bbox.y + bbox.height * anchorFracY

  // Anchor displacement from origin (in local/pre-rotation space)
  const oldDax = oldAnchorX - oldOriginX
  const oldDay = oldAnchorY - oldOriginY

  // Anchor world position (after rotation around origin)
  const anchorWorldX = oldOriginX + oldDax * cos - oldDay * sin
  const anchorWorldY = oldOriginY + oldDax * sin + oldDay * cos

  // 5. Solve for new position
  const newDax = newW * (anchorFracX - 0.5)
  const newDay = newH * (anchorFracY - 0.5)

  // We need: newOrigin + rotate(newDa) = anchorWorld
  const newX = anchorWorldX - newW * 0.5 - newDax * cos + newDay * sin
  const newY = anchorWorldY - newH * 0.5 - newDax * sin - newDay * cos

  // 6. Apply per object type
  return applyNewBBox(type, attrs, { x: newX, y: newY, width: newW, height: newH }, clipDimensions)
}

/** Convert a desired bounding box into the correct attrs for a given object type. */
export function applyNewBBox(
  type: string,
  attrs: Record<string, unknown>,
  newBBox: BBox,
  clipDimensions?: Map<string, BBox>,
): Record<string, unknown> {
  switch (type) {
    case 'rect':
      return {
        x: newBBox.x,
        y: newBBox.y,
        width: newBBox.width,
        height: newBBox.height,
      }

    case 'circle': {
      // Circle stays circular - use larger dimension
      const r = Math.max(newBBox.width, newBBox.height) / 2
      return {
        cx: newBBox.x + newBBox.width / 2,
        cy: newBBox.y + newBBox.height / 2,
        r,
      }
    }

    case 'ellipse':
      return {
        cx: newBBox.x + newBBox.width / 2,
        cy: newBBox.y + newBBox.height / 2,
        rx: newBBox.width / 2,
        ry: newBBox.height / 2,
      }

    case 'path': {
      const d = attrs.d as string
      if (!d) return {}
      const intrinsic = pathIntrinsicBBox(d)
      if (!intrinsic || intrinsic.width === 0 || intrinsic.height === 0) return {}

      // Scale d to new dimensions, keeping it centered at local (0,0)
      const newD = scalePath(d, intrinsic, {
        x: -newBBox.width / 2,
        y: -newBBox.height / 2,
        width: newBBox.width,
        height: newBBox.height,
      })
      return { d: newD, x: newBBox.x + newBBox.width / 2, y: newBBox.y + newBBox.height / 2 }
    }

    case 'group': {
      const children = (attrs.children as FlickObject[]) ?? []
      if (children.length === 0) return { x: newBBox.x, y: newBBox.y, scaleX: 1, scaleY: 1 }
      const childrenBBox = computeGroupChildrenBBox(children, clipDimensions)
      if (!childrenBBox || childrenBBox.width === 0 || childrenBBox.height === 0) {
        return { x: newBBox.x, y: newBBox.y }
      }
      // Compute new scale factors from desired world bbox vs unscaled children bbox
      const newScaleX = newBBox.width / childrenBBox.width
      const newScaleY = newBBox.height / childrenBBox.height
      // Derive new position: worldBBox.x = x + childrenBBox.x * scaleX
      const newX = newBBox.x - childrenBBox.x * newScaleX
      const newY = newBBox.y - childrenBBox.y * newScaleY
      return { x: newX, y: newY, scaleX: newScaleX, scaleY: newScaleY }
    }

    case 'clip': {
      // Clip scaling works like group: adjust scaleX/scaleY + position
      const oldSx = (attrs.scaleX as number) ?? 1
      const oldSy = (attrs.scaleY as number) ?? 1
      const oldClipX = (attrs.x as number) ?? 0
      const oldClipY = (attrs.y as number) ?? 0
      const oldBBox = computeBBox({ id: '', type: 'clip', attrs } as FlickObject, clipDimensions)
      if (!oldBBox || oldBBox.width === 0 || oldBBox.height === 0) {
        return { x: newBBox.x + newBBox.width / 2, y: newBBox.y + newBBox.height / 2 }
      }
      const ratioW = newBBox.width / oldBBox.width
      const ratioH = newBBox.height / oldBBox.height
      const newScaleX = oldSx * ratioW
      const newScaleY = oldSy * ratioH
      // Preserve the relationship between clip origin and bbox corner
      const newX = newBBox.x - (oldBBox.x - oldClipX) * ratioW
      const newY = newBBox.y - (oldBBox.y - oldClipY) * ratioH
      return {
        x: newX,
        y: newY,
        scaleX: newScaleX,
        scaleY: newScaleY,
      }
    }

    default:
      return {}
  }
}

function computeGroupChildrenBBox(children: FlickObject[], clipDimensions?: Map<string, BBox>): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const child of children) {
    const b = computeBBox(child, clipDimensions)
    if (!b) continue
    if (b.x < minX) minX = b.x
    if (b.y < minY) minY = b.y
    if (b.x + b.width > maxX) maxX = b.x + b.width
    if (b.y + b.height > maxY) maxY = b.y + b.height
  }
  if (!isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

// ── Path coordinate rewriting ──

const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi

/**
 * Transform all coordinates in a path d string so its intrinsic bbox
 * maps from oldBBox to newBBox. Preserves command structure.
 */
function scalePath(d: string, oldBBox: BBox, newBBox: BBox): string {
  const sx = oldBBox.width > 0 ? newBBox.width / oldBBox.width : 1
  const sy = oldBBox.height > 0 ? newBBox.height / oldBBox.height : 1

  const absX = (v: number) => newBBox.x + (v - oldBBox.x) * sx
  const absY = (v: number) => newBBox.y + (v - oldBBox.y) * sy
  const relX = (v: number) => v * sx
  const relY = (v: number) => v * sy

  const fmt = (n: number) => {
    const r = Math.round(n * 1000) / 1000
    return r === Math.floor(r) ? String(r) : r.toFixed(3).replace(/0+$/, '')
  }

  const parts: string[] = []

  for (const match of d.matchAll(CMD_RE)) {
    const type = match[1]
    const args = match[2].match(NUM_RE)?.map(Number) ?? []
    const isRel = type === type.toLowerCase()
    const abs = type.toUpperCase()
    const tx = isRel ? relX : absX
    const ty = isRel ? relY : absY

    const out: number[] = []

    switch (abs) {
      case 'M': case 'L': case 'T':
        for (let i = 0; i < args.length; i += 2)
          out.push(tx(args[i]), ty(args[i + 1]))
        break
      case 'H':
        for (const a of args) out.push(tx(a))
        break
      case 'V':
        for (const a of args) out.push(ty(a))
        break
      case 'C':
        for (let i = 0; i < args.length; i += 6)
          out.push(tx(args[i]), ty(args[i+1]), tx(args[i+2]), ty(args[i+3]), tx(args[i+4]), ty(args[i+5]))
        break
      case 'S': case 'Q':
        for (let i = 0; i < args.length; i += 4)
          out.push(tx(args[i]), ty(args[i+1]), tx(args[i+2]), ty(args[i+3]))
        break
      case 'A':
        for (let i = 0; i < args.length; i += 7)
          out.push(args[i] * sx, args[i+1] * sy, args[i+2], args[i+3], args[i+4], tx(args[i+5]), ty(args[i+6]))
        break
      case 'Z':
        break
    }

    parts.push(type + (out.length > 0 ? out.map(fmt).join(',') : ''))
  }

  return parts.join(' ')
}

/**
 * Recenter a path d string so its intrinsic bbox is centered at local (0,0).
 * Returns the recentered d string and the world position of the center.
 */
export function recenterPath(d: string): { d: string; x: number; y: number } {
  const intrinsic = pathIntrinsicBBox(d)
  if (!intrinsic || intrinsic.width === 0 || intrinsic.height === 0) return { d, x: 0, y: 0 }
  const cx = intrinsic.x + intrinsic.width / 2
  const cy = intrinsic.y + intrinsic.height / 2
  const newD = scalePath(d, intrinsic, {
    x: -intrinsic.width / 2,
    y: -intrinsic.height / 2,
    width: intrinsic.width,
    height: intrinsic.height,
  })
  return { d: newD, x: cx, y: cy }
}
