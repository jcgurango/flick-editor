import type { FlickObject } from '../types/project'

export interface BBox {
  x: number
  y: number
  width: number
  height: number
}

type Point = [number, number]

/** Compute the axis-aligned bounding box for an object (before rotation). */
export function computeBBox(obj: FlickObject): BBox | null {
  const a = obj.attrs as Record<string, number>

  switch (obj.type) {
    case 'rect':
      return { x: a.x ?? 0, y: a.y ?? 0, width: a.width ?? 0, height: a.height ?? 0 }

    case 'circle': {
      const r = a.r ?? 0
      return { x: (a.cx ?? 0) - r, y: (a.cy ?? 0) - r, width: r * 2, height: r * 2 }
    }

    case 'ellipse': {
      const rx = a.rx ?? 0, ry = a.ry ?? 0
      return { x: (a.cx ?? 0) - rx, y: (a.cy ?? 0) - ry, width: rx * 2, height: ry * 2 }
    }

    case 'line': {
      const x1 = a.x1 ?? 0, y1 = a.y1 ?? 0, x2 = a.x2 ?? 0, y2 = a.y2 ?? 0
      const minX = Math.min(x1, x2), minY = Math.min(y1, y2)
      return { x: minX, y: minY, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
    }

    case 'path': {
      const d = obj.attrs.d as string | undefined
      if (!d) return null
      const px = a.x ?? 0, py = a.y ?? 0
      const intrinsic = pathIntrinsicBBox(d)
      if (!intrinsic) return null
      return {
        x: intrinsic.x + px,
        y: intrinsic.y + py,
        width: intrinsic.width,
        height: intrinsic.height,
      }
    }

    default:
      return null
  }
}

/** Compute the center of a bounding box (used as the rotation/transform origin). */
export function absoluteOrigin(_obj: FlickObject, bbox: BBox): Point {
  return [bbox.x + bbox.width * 0.5, bbox.y + bbox.height * 0.5]
}

/** Get the 4 corners of a bounding box after rotation around an origin. */
export function rotatedCorners(bbox: BBox, rotation: number, origin: Point): Point[] {
  const corners: Point[] = [
    [bbox.x, bbox.y],
    [bbox.x + bbox.width, bbox.y],
    [bbox.x + bbox.width, bbox.y + bbox.height],
    [bbox.x, bbox.y + bbox.height],
  ]

  if (!rotation) return corners

  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const [ox, oy] = origin

  return corners.map(([x, y]) => {
    const dx = x - ox, dy = y - oy
    return [ox + dx * cos - dy * sin, oy + dx * sin + dy * cos] as Point
  })
}

// ── Path bounding box ──

const NUM_RE = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/gi
const CMD_RE = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g

/** Compute the intrinsic bounding box of a path's d attribute (no translate/scale). */
export function pathIntrinsicBBox(d: string): BBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const expand = (x: number, y: number) => {
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  let cx = 0, cy = 0, sx = 0, sy = 0

  for (const match of d.matchAll(CMD_RE)) {
    const type = match[1]
    const args = match[2].match(NUM_RE)?.map(Number) ?? []
    const isRel = type === type.toLowerCase()
    const abs = type.toUpperCase()
    const ox = isRel ? cx : 0, oy = isRel ? cy : 0

    switch (abs) {
      case 'M':
        cx = args[0] + ox; cy = args[1] + oy
        sx = cx; sy = cy
        expand(cx, cy)
        for (let i = 2; i < args.length; i += 2) {
          cx = args[i] + ox; cy = args[i + 1] + oy
          expand(cx, cy)
        }
        break
      case 'L':
        for (let i = 0; i < args.length; i += 2) {
          cx = args[i] + ox; cy = args[i + 1] + oy
          expand(cx, cy)
        }
        break
      case 'H':
        for (const a of args) { cx = a + ox; expand(cx, cy) }
        break
      case 'V':
        for (const a of args) { cy = a + oy; expand(cx, cy) }
        break
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          expand(args[i] + ox, args[i + 1] + oy)
          expand(args[i + 2] + ox, args[i + 3] + oy)
          cx = args[i + 4] + ox; cy = args[i + 5] + oy
          expand(cx, cy)
        }
        break
      case 'S':
        for (let i = 0; i < args.length; i += 4) {
          expand(args[i] + ox, args[i + 1] + oy)
          cx = args[i + 2] + ox; cy = args[i + 3] + oy
          expand(cx, cy)
        }
        break
      case 'Q':
        for (let i = 0; i < args.length; i += 4) {
          expand(args[i] + ox, args[i + 1] + oy)
          cx = args[i + 2] + ox; cy = args[i + 3] + oy
          expand(cx, cy)
        }
        break
      case 'T':
        for (let i = 0; i < args.length; i += 2) {
          cx = args[i] + ox; cy = args[i + 1] + oy
          expand(cx, cy)
        }
        break
      case 'A':
        for (let i = 0; i < args.length; i += 7) {
          cx = args[i + 5] + ox; cy = args[i + 6] + oy
          expand(cx, cy)
        }
        break
      case 'Z':
        cx = sx; cy = sy
        break
    }
  }

  if (!isFinite(minX)) return null
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}
