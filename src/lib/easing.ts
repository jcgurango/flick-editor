import {
  easeLinear,
  easeQuadIn, easeQuadOut, easeQuadInOut,
  easeCubicIn, easeCubicOut, easeCubicInOut,
  easeExpIn, easeExpOut, easeExpInOut,
  easeCircleIn, easeCircleOut, easeCircleInOut,
  easeElasticIn, easeElasticOut, easeElasticInOut,
  easeBounceIn, easeBounceOut, easeBounceInOut,
} from 'd3-ease';

import type { TweenType, EasingDirection } from '../store/projectStore';

type EasingFn = (t: number) => number;

const EASING_TABLE: Record<string, EasingFn> = {
  'linear:in': easeLinear,
  'linear:out': easeLinear,
  'linear:in-out': easeLinear,

  'quadratic:in': easeQuadIn,
  'quadratic:out': easeQuadOut,
  'quadratic:in-out': easeQuadInOut,

  'cubic:in': easeCubicIn,
  'cubic:out': easeCubicOut,
  'cubic:in-out': easeCubicInOut,

  'exponential:in': easeExpIn,
  'exponential:out': easeExpOut,
  'exponential:in-out': easeExpInOut,

  'circular:in': easeCircleIn,
  'circular:out': easeCircleOut,
  'circular:in-out': easeCircleInOut,

  'elastic:in': easeElasticIn,
  'elastic:out': easeElasticOut,
  'elastic:in-out': easeElasticInOut,

  'bounce:in': easeBounceIn,
  'bounce:out': easeBounceOut,
  'bounce:in-out': easeBounceInOut,
};

/**
 * Get the easing function for a given tween type and direction.
 * `discrete` returns () => 0 — the caller should show the "before" keyframe unchanged.
 */
export function getEasingFn(tween: TweenType, easing: EasingDirection): EasingFn {
  if (tween === 'discrete') return () => 0;
  return EASING_TABLE[`${tween}:${easing}`] ?? easeLinear;
}
