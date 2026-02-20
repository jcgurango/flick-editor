import type { AnimationLayer, Keyframe } from '../store/projectStore';
import { interpolateSvg, extractSvgInnerContent } from './interpolation';

/**
 * Find the surrounding keyframes for a given frame.
 * Returns [before, after] where either can be null.
 */
function findSurroundingKeyframes(
  keyframes: Keyframe[],
  frame: number
): [Keyframe | null, Keyframe | null] {
  let before: Keyframe | null = null;
  let after: Keyframe | null = null;

  for (const kf of keyframes) {
    if (kf.frame <= frame) {
      before = kf;
    } else {
      after = kf;
      break;
    }
  }

  return [before, after];
}

/**
 * Render a single layer at a given frame.
 * Returns the inner SVG content string, or empty string if no keyframes.
 */
function renderLayer(layer: AnimationLayer, frame: number): string {
  if (layer.keyframes.length === 0) return '';

  const [before, after] = findSurroundingKeyframes(layer.keyframes, frame);

  if (!before) {
    // Frame is before any keyframe — nothing to show
    return '';
  }

  if (!after || before.frame === frame) {
    // Exactly on a keyframe, or past the last one — use before directly
    return extractSvgInnerContent(before.svgContent);
  }

  // Between two keyframes — interpolate
  const range = after.frame - before.frame;
  const t = (frame - before.frame) / range;

  const interpolated = interpolateSvg(before.svgContent, after.svgContent, t);
  return extractSvgInnerContent(interpolated);
}

/**
 * Composite all visible layers at a given frame into a single SVG inner content string.
 * Layers are rendered bottom-up (last in array = bottom of stack).
 */
export function compositeFrame(
  layers: AnimationLayer[],
  frame: number,
  _width: number,
  _height: number
): string {
  let combined = '';

  // Render layers in reverse order (bottom-up in z-order)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.visible || layer.keyframes.length === 0) continue;

    const inner = renderLayer(layer, frame);
    if (inner) {
      combined += `<g data-layer="${layer.id}">${inner}</g>\n`;
    }
  }

  return combined;
}
