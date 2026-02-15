export type TweenType = 'discrete' | 'linear' | 'smooth' | 'cubic' | 'exponential' | 'circular' | 'elastic' | 'bounce'
export type EaseDirection = 'in' | 'out' | 'in-out'

/** A single drawable object on the canvas. */
export interface FlickObject {
  /** Stable unique identifier that persists across frames/edits. */
  id: string
  /** Object type, e.g. "rect", "ellipse", "path", "line", "group". */
  type: string
  /** SVG-relevant attributes: x, y, width, height, fill, stroke, d, etc. */
  attrs: Record<string, unknown>
}

/** A snapshot of a layer's contents at a specific frame. */
export interface Keyframe {
  /** 1-based frame number. */
  frame: number
  /** All objects visible on this layer at this keyframe. */
  objects: FlickObject[]
  /** How to interpolate from this keyframe toward the next. */
  tween: TweenType
  /** Ease direction for the tween. */
  easeDirection: EaseDirection
}

/** A named layer containing keyframed content. */
export interface Layer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  keyframes: Keyframe[]
}

/** Top-level project. */
export interface Project {
  name: string
  frameRate: number
  width: number
  height: number
  layers: Layer[]
}

// ── Helpers ──

let _nextId = 1

export function generateId(): string {
  return `obj_${Date.now()}_${_nextId++}`
}

export function createProject(name = 'Untitled'): Project {
  return {
    name,
    frameRate: 30,
    width: 1920,
    height: 1080,
    layers: [createLayer('Layer 1')],
  }
}

export function createLayer(name: string): Layer {
  return {
    id: generateId(),
    name,
    visible: true,
    locked: false,
    keyframes: [{ frame: 1, objects: [], tween: 'discrete', easeDirection: 'in-out' }],
  }
}

/**
 * Resolve which keyframe is active for a layer at a given frame.
 * Returns the keyframe with the highest frame number <= the target frame,
 * or undefined if the layer has no keyframes at or before that frame.
 */
export function getActiveKeyframe(layer: Layer, frame: number): Keyframe | undefined {
  let best: Keyframe | undefined
  for (const kf of layer.keyframes) {
    if (kf.frame <= frame && (!best || kf.frame > best.frame)) {
      best = kf
    }
  }
  return best
}

/**
 * Get the next keyframe after the given frame on a layer.
 */
export function getNextKeyframe(layer: Layer, frame: number): Keyframe | undefined {
  let best: Keyframe | undefined
  for (const kf of layer.keyframes) {
    if (kf.frame > frame && (!best || kf.frame < best.frame)) {
      best = kf
    }
  }
  return best
}
