import type { TweenType, EaseDirection, FlickObject, Layer } from '../types/project'
import { getActiveKeyframe, getNextKeyframe } from '../types/project'
import { interpolatePath } from './path-morph'

// ── Easing Functions ──
// Each takes t in [0,1] and returns eased t

type EaseFn = (t: number) => number

const easingFunctions: Record<Exclude<TweenType, 'discrete'>, EaseFn> = {
  linear: (t) => t,

  smooth: (t) => t * t, // quadratic ease-in — wrappers produce proper ease-out/in-out

  cubic: (t) => t * t * t,

  exponential: (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),

  circular: (t) => 1 - Math.sqrt(1 - t * t),

  elastic: (t) => {
    if (t === 0 || t === 1) return t
    const p = 0.3
    const s = p / 4
    return -(Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1 - s) * (2 * Math.PI)) / p))
  },

  bounce: (t) => {
    // Ease-in bounce: flip the ease-out bounce
    return 1 - bounceOut(1 - t)
  },
}

function bounceOut(t: number): number {
  if (t < 1 / 2.75) {
    return 7.5625 * t * t
  } else if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75
    return 7.5625 * t2 * t2 + 0.75
  } else if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75
    return 7.5625 * t2 * t2 + 0.9375
  } else {
    const t2 = t - 2.625 / 2.75
    return 7.5625 * t2 * t2 + 0.984375
  }
}

// ── Ease Direction Wrappers ──

function applyEaseDirection(fn: EaseFn, direction: EaseDirection): EaseFn {
  switch (direction) {
    case 'in':
      return fn
    case 'out':
      return (t) => 1 - fn(1 - t)
    case 'in-out':
      return (t) => {
        if (t < 0.5) return fn(t * 2) / 2
        return (2 - fn((1 - t) * 2)) / 2
      }
  }
}

export function getEasedT(t: number, tweenType: TweenType, easeDirection: EaseDirection): number {
  if (tweenType === 'discrete') return 0
  const baseFn = easingFunctions[tweenType]
  const easedFn = applyEaseDirection(baseFn, easeDirection)
  return easedFn(Math.max(0, Math.min(1, t)))
}

// ── Attribute Interpolation ──

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

const HEX_RE = /^#([0-9a-f]{3,8})$/i

function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

function parseHex(hex: string): [number, number, number] {
  let h = hex.slice(1)
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  const n = parseInt(h.slice(0, 6), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, '0')).join('')
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  return toHex(lerp(ar, br, t), lerp(ag, bg, t), lerp(ab, bb, t))
}

const PATH_RE = /^[Mm]\s*[-\d]/

function isSvgPath(v: unknown): v is string {
  return typeof v === 'string' && PATH_RE.test(v.trim())
}

function interpolateAttr(a: unknown, b: unknown, t: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') {
    return lerp(a, b, t)
  }
  if (isHexColor(a) && isHexColor(b)) {
    return lerpColor(a, b, t)
  }
  if (isSvgPath(a) && isSvgPath(b)) {
    return interpolatePath(a, b, t)
  }
  // Non-interpolatable: hold value from 'a'
  return a
}

// ── Object Interpolation ──

function interpolateObjects(
  fromObjects: FlickObject[],
  toObjects: FlickObject[],
  t: number,
): FlickObject[] {
  const toMap = new Map(toObjects.map((o) => [o.id, o]))
  const result: FlickObject[] = []

  for (const fromObj of fromObjects) {
    const toObj = toMap.get(fromObj.id)
    if (!toObj) {
      // Object only in 'from' — keep as-is
      result.push(fromObj)
      continue
    }

    // Interpolate attrs
    const interpolatedAttrs: Record<string, unknown> = {}
    const allKeys = new Set([...Object.keys(fromObj.attrs), ...Object.keys(toObj.attrs)])
    for (const key of allKeys) {
      const aVal = fromObj.attrs[key]
      const bVal = toObj.attrs[key]
      if (aVal !== undefined && bVal !== undefined) {
        interpolatedAttrs[key] = interpolateAttr(aVal, bVal, t)
      } else {
        interpolatedAttrs[key] = aVal ?? bVal
      }
    }

    result.push({
      id: fromObj.id,
      type: fromObj.type,
      attrs: interpolatedAttrs,
    })
  }

  // Objects only in 'to' — appear at t=1
  if (t >= 1) {
    for (const toObj of toObjects) {
      if (!fromObjects.some((f) => f.id === toObj.id)) {
        result.push(toObj)
      }
    }
  }

  return result
}

// ── Frame Resolution ──

/**
 * Resolve the objects to render for a layer at a given frame,
 * applying tween interpolation if configured.
 */
export function resolveFrame(layer: Layer, frame: number, totalFrames?: number): FlickObject[] {
  const kfA = getActiveKeyframe(layer, frame)
  if (!kfA) return []

  // If this keyframe is discrete or there's no next keyframe, return as-is
  if (kfA.tween === 'discrete') return kfA.objects

  const kfB = getNextKeyframe(layer, kfA.frame)

  if (!kfB) {
    // No next keyframe — check for loop
    if (kfA.loop && totalFrames && layer.keyframes.length > 0) {
      const firstKf = layer.keyframes.reduce((a, b) => a.frame < b.frame ? a : b)
      if (firstKf.frame !== kfA.frame && firstKf.objects.length > 0) {
        if (frame === kfA.frame) return kfA.objects
        // Interpolate from kfA toward firstKf, treating totalFrames+1 as the virtual target
        const span = totalFrames + 1 - kfA.frame
        const rawT = (frame - kfA.frame) / span
        const easedT = getEasedT(rawT, kfA.tween, kfA.easeDirection)
        return interpolateObjects(kfA.objects, firstKf.objects, easedT)
      }
    }
    return kfA.objects
  }

  // If we're exactly on kfA, return its objects directly
  if (frame === kfA.frame) return kfA.objects
  // If we're at or past kfB, return kfB's objects
  if (frame >= kfB.frame) return kfB.objects

  // Compute interpolation parameter
  const rawT = (frame - kfA.frame) / (kfB.frame - kfA.frame)
  const easedT = getEasedT(rawT, kfA.tween, kfA.easeDirection)

  return interpolateObjects(kfA.objects, kfB.objects, easedT)
}
