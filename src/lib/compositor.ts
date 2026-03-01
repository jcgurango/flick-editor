import type { AnimationLayer, Keyframe, BackgroundSettings, MovieClip } from '../store/projectStore';
import { interpolateSvg, extractSvgInnerContent } from './interpolation';
import { getEasingFn } from './easing';

export type CompositeMode = 'viewport' | 'render';

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
 * When totalFrames is provided and layer.loop is true, interpolation wraps around.
 */
export function renderLayer(layer: AnimationLayer, frame: number, totalFrames?: number): string {
  if (layer.keyframes.length === 0) return '';

  const kfs = layer.keyframes;

  // Loop mode: wrap interpolation across totalFrames boundary
  if (layer.loop && totalFrames && kfs.length >= 2) {
    const first = kfs[0];
    const last = kfs[kfs.length - 1];

    const [before, after] = findSurroundingKeyframes(kfs, frame);

    // Before the first keyframe — interpolate from last (wrapped) to first
    if (!before) {
      const wrapRange = (first.frame + totalFrames) - last.frame;
      const dist = (frame + totalFrames) - last.frame;
      const linearT = dist / wrapRange;
      if (last.tween === 'discrete') {
        return extractSvgInnerContent(last.svgContent);
      }
      const easeFn = getEasingFn(last.tween, last.easing);
      const t = easeFn(linearT);
      return interpolateSvg(last.svgContent, first.svgContent, t);
    }

    // After the last keyframe — interpolate from last to first (wrapped)
    if (!after) {
      if (before.frame === frame) {
        return extractSvgInnerContent(before.svgContent);
      }
      const wrapRange = (first.frame + totalFrames) - last.frame;
      const dist = frame - last.frame;
      const linearT = dist / wrapRange;
      if (last.tween === 'discrete') {
        return extractSvgInnerContent(last.svgContent);
      }
      const easeFn = getEasingFn(last.tween, last.easing);
      const t = easeFn(linearT);
      return interpolateSvg(last.svgContent, first.svgContent, t);
    }

    // Between two keyframes — normal interpolation (fall through below)
  }

  const [before, after] = findSurroundingKeyframes(kfs, frame);

  if (!before) {
    return '';
  }

  if (!after || before.frame === frame) {
    return extractSvgInnerContent(before.svgContent);
  }

  // Discrete tween — show before keyframe unchanged
  if (before.tween === 'discrete') {
    return extractSvgInnerContent(before.svgContent);
  }

  // Between two keyframes — interpolate with easing
  const range = after.frame - before.frame;
  const linearT = (frame - before.frame) / range;
  const easeFn = getEasingFn(before.tween, before.easing);
  const t = easeFn(linearT);

  return interpolateSvg(before.svgContent, after.svgContent, t);
}

// ── Clip Rendering ────────────────────────────────────────

/**
 * Find where a clip reference first appears in a continuous run of keyframes
 * ending at or containing the current frame. Used to compute clip loop start.
 */
function findClipLoopStart(keyframes: Keyframe[], currentFrame: number, clipId: string): number {
  // Find nearest keyframe at or before currentFrame
  let idx = -1;
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].frame <= currentFrame) idx = i;
    else break;
  }
  if (idx < 0) return 0;

  // Walk backwards: find where the continuous run of "has clip" starts
  for (let i = idx; i >= 0; i--) {
    const hasClip = keyframes[i].svgContent.includes(`data-flick-clip="${clipId}"`);
    if (!hasClip) return keyframes[Math.min(i + 1, idx)].frame;
    if (i === 0) return keyframes[0].frame;
  }
  return keyframes[0].frame;
}

/**
 * Resolve <image data-flick-clip="..."> placeholders in SVG content
 * by recursively compositing the referenced clips.
 */
function resolveClipReferences(
  svgInner: string,
  clips: MovieClip[],
  layer: AnimationLayer,
  frame: number,
  totalFrames: number,
  width: number,
  height: number,
  mode: CompositeMode,
  visitedClips?: Set<string>,
): string {
  const visited = visitedClips || new Set<string>();

  // Match <image ... data-flick-clip="clipId" ... /> or <image ... data-flick-clip="clipId" ...></image>
  return svgInner.replace(
    /<image\s[^>]*data-flick-clip="([^"]+)"[^>]*(?:\/>|><\/image>)/g,
    (match, clipId) => {
      // Cycle detection
      if (visited.has(clipId)) return match;

      const clip = clips.find((c) => c.id === clipId);
      if (!clip) return match;

      // Extract position/size from the image element
      const xMatch = match.match(/\bx="([^"]+)"/);
      const yMatch = match.match(/\by="([^"]+)"/);
      const wMatch = match.match(/\bwidth="([^"]+)"/);
      const hMatch = match.match(/\bheight="([^"]+)"/);

      const ix = xMatch ? parseFloat(xMatch[1]) : 0;
      const iy = yMatch ? parseFloat(yMatch[1]) : 0;
      const iw = wMatch ? parseFloat(wMatch[1]) : clip.width;
      const ih = hMatch ? parseFloat(hMatch[1]) : clip.height;

      // Compute clip frame with looping
      const loopStart = findClipLoopStart(layer.keyframes, frame, clipId);
      const clipFrame = clip.totalFrames > 0
        ? ((frame - loopStart) % clip.totalFrames + clip.totalFrames) % clip.totalFrames
        : 0;

      // Recursively composite the clip
      const newVisited = new Set(visited);
      newVisited.add(clipId);
      const clipContent = compositeFrame(
        clip.layers, clipFrame, clip.width, clip.height, mode,
        clip.totalFrames, clips, newVisited,
      );

      // Replace the <image> with an inline <svg> containing the composited clip
      return `<svg x="${ix}" y="${iy}" width="${iw}" height="${ih}" viewBox="0 0 ${clip.width} ${clip.height}">${clipContent}</svg>`;
    }
  );
}

/**
 * Composite all visible layers at a given frame into a single SVG inner content string.
 * Layers are rendered bottom-up (last in array = bottom of stack).
 */
export function compositeFrame(
  layers: AnimationLayer[],
  frame: number,
  _width: number,
  _height: number,
  mode: CompositeMode = 'viewport',
  totalFrames?: number,
  clips?: MovieClip[],
  visitedClips?: Set<string>,
): string {
  let defs = '';
  let combined = '';
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const isVisible = (l: AnimationLayer) =>
    mode === 'render' ? l.renderVisible : l.viewportVisible;

  // Render layers in reverse order (bottom-up in z-order)
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!isVisible(layer) || layer.keyframes.length === 0) continue;

    let inner = renderLayer(layer, frame, totalFrames);
    if (!inner) continue;

    // Resolve clip references in this layer's content
    if (clips && clips.length > 0) {
      inner = resolveClipReferences(inner, clips, layer, frame, totalFrames || 0, _width, _height, mode, visitedClips);
    }

    // Build clip-path / mask defs if referenced
    let attrs = '';

    if (layer.clipLayerId) {
      const clipLayer = layerMap.get(layer.clipLayerId);
      if (clipLayer && clipLayer.keyframes.length > 0) {
        const clipContent = renderLayer(clipLayer, frame, totalFrames);
        if (clipContent) {
          const clipId = `clip-${layer.id}`;
          defs += `<clipPath id="${clipId}">${clipContent}</clipPath>\n`;
          attrs += ` clip-path="url(#${clipId})"`;
        }
      }
    }

    if (layer.maskLayerId) {
      const maskLayer = layerMap.get(layer.maskLayerId);
      if (maskLayer && maskLayer.keyframes.length > 0) {
        const maskContent = renderLayer(maskLayer, frame, totalFrames);
        if (maskContent) {
          const maskId = `mask-${layer.id}`;
          defs += `<mask id="${maskId}">${maskContent}</mask>\n`;
          attrs += ` mask="url(#${maskId})"`;
        }
      }
    }

    combined += `<g data-layer="${layer.id}"${attrs}>${inner}</g>\n`;
  }

  return (defs ? `<defs>${defs}</defs>\n` : '') + combined;
}

/**
 * Export a single frame as a complete SVG string.
 */
export function exportFrame(
  layers: AnimationLayer[],
  frame: number,
  width: number,
  height: number,
  background: BackgroundSettings | null,
  exportWidth?: number,
  exportHeight?: number,
  totalFrames?: number,
  clips?: MovieClip[],
): string {
  const w = exportWidth || width;
  const h = exportHeight || height;
  const inner = compositeFrame(layers, frame, width, height, 'render', totalFrames, clips);

  let bgContent = '';
  if (background) {
    if (background.type === 'solid') {
      bgContent = `<rect width="${width}" height="${height}" fill="${background.color}"/>`;
    } else if (background.type === 'image' && background.imageData) {
      bgContent = `<rect width="${width}" height="${height}" fill="white"/><image href="${background.imageData}" width="${width}" height="${height}"/>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${width} ${height}">\n${bgContent}${inner}</svg>`;
}
