import type { BBox } from './bbox'
import { pathIntrinsicBBox } from './bbox'

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
      return {
        translateX: (attrs.translateX as number ?? 0) + dx,
        translateY: (attrs.translateY as number ?? 0) + dy,
      }
    default:
      return {}
  }
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
    // Anchor = origin
    anchorFracX = (attrs.originX as number) ?? 0.5
    anchorFracY = (attrs.originY as number) ?? 0.5
  } else {
    // Anchor = opposite side
    // If dragging right, anchor left (0). If dragging left, anchor right (1). If edge (no L/R), anchor center (0.5).
    anchorFracX = growsRight ? 0 : growsLeft ? 1 : 0.5
    anchorFracY = growsDown ? 0 : growsUp ? 1 : 0.5
  }

  // 4. Compute anchor's world position using OLD bbox
  const originPctX = (attrs.originX as number) ?? 0.5
  const originPctY = (attrs.originY as number) ?? 0.5
  const oldOriginX = bbox.x + bbox.width * originPctX
  const oldOriginY = bbox.y + bbox.height * originPctY
  const oldAnchorX = bbox.x + bbox.width * anchorFracX
  const oldAnchorY = bbox.y + bbox.height * anchorFracY

  // Anchor displacement from origin (in local/pre-rotation space)
  const oldDax = oldAnchorX - oldOriginX
  const oldDay = oldAnchorY - oldOriginY

  // Anchor world position (after rotation around origin)
  const anchorWorldX = oldOriginX + oldDax * cos - oldDay * sin
  const anchorWorldY = oldOriginY + oldDax * sin + oldDay * cos

  // 5. Solve for new position
  // New anchor displacement from new origin:
  // newOrigin = (newX + newW * originPctX, newY + newH * originPctY)
  // newAnchor = (newX + newW * anchorFracX, newY + newH * anchorFracY)
  // newDax = newW * (anchorFracX - originPctX)
  // newDay = newH * (anchorFracY - originPctY)
  const newDax = newW * (anchorFracX - originPctX)
  const newDay = newH * (anchorFracY - originPctY)

  // We need: newOrigin + rotate(newDa) = anchorWorld
  // newOriginX + newDax * cos - newDay * sin = anchorWorldX
  // (newX + newW * originPctX) + newDax * cos - newDay * sin = anchorWorldX
  const newX = anchorWorldX - newW * originPctX - newDax * cos + newDay * sin
  const newY = anchorWorldY - newH * originPctY - newDax * sin - newDay * cos

  // 6. Apply per object type
  return applyNewBBox(type, attrs, { x: newX, y: newY, width: newW, height: newH })
}

/** Convert a desired bounding box into the correct attrs for a given object type. */
function applyNewBBox(
  type: string,
  attrs: Record<string, unknown>,
  newBBox: BBox,
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

      // Derive scaleX/Y and translateX/Y from the desired bbox
      // rendered: x = intrinsic.x * sx + tx, width = intrinsic.width * sx
      const sx = newBBox.width / intrinsic.width
      const sy = newBBox.height / intrinsic.height
      const tx = newBBox.x - intrinsic.x * sx
      const ty = newBBox.y - intrinsic.y * sy

      return { scaleX: sx, scaleY: sy, translateX: tx, translateY: ty }
    }

    default:
      return {}
  }
}
