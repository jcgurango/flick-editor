import { create } from 'zustand';
import { compositeFrame, renderLayer } from '../lib/compositor';
import { normalizeSvgForDiff } from '../lib/svg-diff';

// ── Clip Mode Detection ───────────────────────────────────

const _clipId = new URLSearchParams(window.location.search).get('clipId');
export const isClipMode = !!_clipId;
export const editingClipId = _clipId;

// ── Data Model ────────────────────────────────────────────

export type TweenType = 'discrete' | 'linear' | 'quadratic' | 'cubic'
  | 'exponential' | 'circular' | 'elastic' | 'bounce';
export type EasingDirection = 'in' | 'out' | 'in-out';

export type ExportFormat = 'svg' | 'png';

export type BackgroundType = 'none' | 'solid' | 'image' | 'video';
export interface BackgroundSettings {
  type: BackgroundType;
  color: string;       // hex, used when type === 'solid'
  imageData: string;   // URL (file:/// or http://), used when type === 'image' or 'video'
  videoStartTime: number;  // seconds offset into the video
  videoAudio: boolean;     // whether to play audio (default true)
}

export interface Keyframe {
  frame: number;        // 0-indexed, matches kf_NNN.svg
  svgContent: string;   // Full SVG loaded in memory
  tween: TweenType;
  easing: EasingDirection;
}

export interface AnimationLayer {
  id: string;
  name?: string;              // display name (empty = show id)
  renderVisible: boolean;   // included in export (camera)
  viewportVisible: boolean; // visible in editor (eye)
  clipLayerId: string | null;  // layer used as clip-path (compositing only)
  maskLayerId: string | null;  // layer used as mask (compositing only)
  loop: boolean;             // wrap interpolation around totalFrames boundary
  ghostEndFrame: boolean;    // show extra guide frame at totalFrames for tweening
  keyframes: Keyframe[]; // Sorted by frame
}

export interface MovieClip {
  id: string;
  name: string;
  width: number;
  height: number;
  totalFrames: number;
  layers: AnimationLayer[];
}

export interface UndoSnapshot {
  layers: AnimationLayer[];
  clips: MovieClip[];
}

export interface EditingState {
  frame: number;
}

/** Rectangular selection on the timeline grid */
export interface TimelineSelection {
  anchorLayerIdx: number;
  anchorFrame: number;
  endLayerIdx: number;
  endFrame: number;
}

/** Clipboard cell: SVG content plus tween/easing metadata */
export interface ClipboardCell {
  svgContent: string;
  tween: TweenType;
  easing: EasingDirection;
}

/** Clipboard: 2D grid of keyframe data (or null for empty cells) */
export interface ClipboardContent {
  cells: (ClipboardCell | null)[][]; // [layerOffset][frameOffset]
  layerCount: number;
  frameCount: number;
}

/** Derive normalized rect from a selection */
export function selectionRect(sel: TimelineSelection) {
  return {
    minLayerIdx: Math.min(sel.anchorLayerIdx, sel.endLayerIdx),
    maxLayerIdx: Math.max(sel.anchorLayerIdx, sel.endLayerIdx),
    minFrame: Math.min(sel.anchorFrame, sel.endFrame),
    maxFrame: Math.max(sel.anchorFrame, sel.endFrame),
  };
}

export interface ProjectState extends MovieClip {
  // Project metadata
  projectPath: string | null;
  exportPath: string | null;
  exportFormat: ExportFormat;
  exportRenderBg: boolean;
  exportWidth: number | null;   // null = use project width
  exportHeight: number | null;  // null = use project height
  dirty: boolean;

  // Project settings
  fps: number;
  background: BackgroundSettings;

  // Movie clips
  clips: MovieClip[];

  // Timeline
  selectedLayerId: string | null;
  currentFrame: number;  // 0-indexed internally

  // Timeline selection
  selection: TimelineSelection | null;
  clipboard: ClipboardContent | null;

  // Canvas view
  canvasZoom: number;
  canvasPanX: number;
  canvasPanY: number;
  canvasContainerWidth: number;
  canvasContainerHeight: number;

  // Composited SVG content for display
  compositedSvg: string;

  // Video background snapshot (JPEG data URL for Inkscape/export, not persisted)
  videoSnapshot: string;

  // Inkscape editing state
  editingKeyframe: EditingState | null;
  lastKnownInkscapeState: Map<string, string>;

  // Undo/redo
  undoStack: UndoSnapshot[];
  redoStack: UndoSnapshot[];
  canUndo: boolean;
  canRedo: boolean;

  // ── Project lifecycle ─────────────────────────────────

  newProject: () => void;

  openProject: (filePath: string) => Promise<void>;
  saveProject: () => Promise<void>;

  // ── Layer actions ─────────────────────────────────────

  addLayer: () => Promise<void>;
  removeLayer: (id: string) => void;
  renameLayer: (id: string, name: string) => void;
  moveLayer: (fromIdx: number, toIdx: number) => void;
  toggleRenderVisible: (id: string) => void;
  toggleViewportVisible: (id: string) => void;
  setLayerClip: (id: string, clipLayerId: string | null) => void;
  setLayerMask: (id: string, maskLayerId: string | null) => void;
  setLayerLoop: (id: string, loop: boolean) => void;
  setLayerGhostEndFrame: (id: string, ghost: boolean) => void;
  selectLayer: (id: string | null) => void;

  // ── Keyframe actions ──────────────────────────────────

  addKeyframe: (layerId: string, frame: number, fromReference?: boolean) => Promise<void>;
  removeKeyframe: (layerId: string, frame: number) => void;
  setKeyframeTween: (layerId: string, frame: number, tween: TweenType) => void;
  setKeyframeEasing: (layerId: string, frame: number, easing: EasingDirection) => void;

  // ── Selection / Clipboard ─────────────────────────────

  setSelectionAnchor: (layerIdx: number, frame: number) => void;
  setSelectionEnd: (layerIdx: number, frame: number) => void;
  commitSelection: () => void;
  clearSelection: () => void;
  copySelection: () => void;
  pasteAtSelection: () => void;
  deleteSelection: () => void;

  // ── Inkscape editing ──────────────────────────────────

  startEditing: (frame: number) => Promise<void>;
  handleInkscapeSave: (svgContent: string) => Promise<void>;
  reloadInkscapeDocument: () => Promise<void>;

  // ── Timeline / Canvas ─────────────────────────────────

  setCurrentFrame: (frame: number) => void;
  setCanvasZoom: (zoom: number) => void;
  setCanvasPan: (x: number, y: number) => void;
  resetCanvasView: () => void;
  setCanvasZoom100: () => void;
  setCanvasContainerSize: (w: number, h: number) => void;
  setProjectDimensions: (width: number, height: number) => void;
  setFps: (fps: number) => void;
  setTotalFrames: (totalFrames: number) => void;
  setBackground: (bg: Partial<BackgroundSettings>) => void;
  setVideoSnapshot: (dataUrl: string) => void;
  setExportPath: (path: string | null) => void;
  setExportFormat: (format: ExportFormat) => void;
  setExportRenderBg: (renderBg: boolean) => void;
  setExportWidth: (width: number | null) => void;
  setExportHeight: (height: number | null) => void;

  // ── Undo/Redo ─────────────────────────────────────────

  undo: () => void;
  redo: () => void;

  // ── Playback ────────────────────────────────────────

  playing: boolean;
  play: () => void;
  stop: () => void;

  // ── Movie Clips ──────────────────────────────────────

  handleNClip: (elementId: string) => void;
  syncClipsToInkscape: () => void;
  renameClip: (id: string, name: string) => void;
  duplicateClip: (id: string) => void;
  deleteClip: (id: string) => void;
  openClipEditor: (clipId: string) => void;

  // ── Compositor ────────────────────────────────────────

  recomposite: () => void;
}

// ── Helpers ───────────────────────────────────────────────

const MAX_UNDO = 50;

/** Find the nearest keyframe at or before the given frame */
function findNearestKeyframe(keyframes: Keyframe[], frame: number): Keyframe | null {
  let best: Keyframe | null = null;
  for (const kf of keyframes) {
    if (kf.frame <= frame) {
      best = kf;
    } else {
      break; // keyframes are sorted
    }
  }
  return best;
}

/** Create a blank SVG with the given dimensions */
function blankSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
}

/** Escape XML special characters in attribute values */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Strip href from <image data-flick-clip> elements (redundant with clips section) */
function stripClipHrefs(svgContent: string): string {
  return svgContent.replace(
    /<image\s[^>]*data-flick-clip="[^"]+?"[^>]*(?:\/>|><\/image>)/g,
    (match) => match.replace(/\s*href="[^"]*"/, ''),
  );
}

/** Inject href into <image data-flick-clip> elements that are missing it */
function injectClipHrefsInLayers(layers: AnimationLayer[], clips: MovieClip[]): AnimationLayer[] {
  if (clips.length === 0) return layers;
  const clipHrefs = new Map<string, string>();
  for (const clip of clips) {
    const firstKf = clip.layers[0]?.keyframes[0];
    if (firstKf) {
      const b64 = btoa(unescape(encodeURIComponent(firstKf.svgContent)));
      clipHrefs.set(clip.id, `data:image/svg+xml;base64,${b64}`);
    }
  }
  return layers.map((layer) => ({
    ...layer,
    keyframes: layer.keyframes.map((kf) => {
      if (!kf.svgContent.includes('data-flick-clip=')) return kf;
      return {
        ...kf,
        svgContent: kf.svgContent.replace(
          /<image\s([^>]*data-flick-clip="([^"]+)"[^>]*)(\/?>(?:<\/image>)?)/g,
          (match, before, clipId) => {
            if (/\bhref="/.test(before)) return match;
            const href = clipHrefs.get(clipId);
            if (!href) return match;
            return `<image ${before.replace(/\/\s*$/, '')} href="${href}"/>`;
          },
        ),
      };
    }),
  }));
}

/** Scale width/height of all instances of a clip in keyframe SVGs */
export function propagateClipDimensions(
  layers: AnimationLayer[],
  clipId: string,
  oldWidth: number, oldHeight: number,
  newWidth: number, newHeight: number,
): AnimationLayer[] {
  if (oldWidth === newWidth && oldHeight === newHeight) return layers;
  const scaleX = newWidth / oldWidth;
  const scaleY = newHeight / oldHeight;
  return layers.map((layer) => ({
    ...layer,
    keyframes: layer.keyframes.map((kf) => {
      if (!kf.svgContent.includes(`data-flick-clip="${clipId}"`)) return kf;
      return {
        ...kf,
        svgContent: kf.svgContent.replace(
          /<image\s[^>]*data-flick-clip="[^"]+?"[^>]*(?:\/>|><\/image>)/g,
          (match) => {
            if (!match.includes(`data-flick-clip="${clipId}"`)) return match;
            return match
              .replace(/\bwidth="([^"]+)"/, (_, w) => `width="${parseFloat(w) * scaleX}"`)
              .replace(/\bheight="([^"]+)"/, (_, h) => `height="${parseFloat(h) * scaleY}"`);
          },
        ),
      };
    }),
  }));
}

/** Apply `propagateClipDimensions` to both `state.layers` and every clip's layers. */
export function propagateClipDimensionsAll(
  layers: AnimationLayer[],
  clips: MovieClip[],
  clipId: string,
  oldWidth: number, oldHeight: number,
  newWidth: number, newHeight: number,
): { layers: AnimationLayer[]; clips: MovieClip[] } {
  if (oldWidth === newWidth && oldHeight === newHeight) return { layers, clips };
  return {
    layers: propagateClipDimensions(layers, clipId, oldWidth, oldHeight, newWidth, newHeight),
    clips: clips.map((c) => ({
      ...c,
      layers: propagateClipDimensions(c.layers, clipId, oldWidth, oldHeight, newWidth, newHeight),
    })),
  };
}

/** Serialize layers to XML with configurable indent */
function serializeLayersXml(layers: AnimationLayer[], indent: string): string {
  let xml = '';
  for (const layer of layers) {
    xml += `${indent}<layer id="${escXml(layer.id)}"${layer.name ? ` name="${escXml(layer.name)}"` : ''} render-visible="${layer.renderVisible}" viewport-visible="${layer.viewportVisible}"`;
    xml += ` clip="${escXml(layer.clipLayerId ?? '')}" mask="${escXml(layer.maskLayerId ?? '')}"`;
    xml += ` loop="${layer.loop}" ghost-end-frame="${layer.ghostEndFrame}">\n`;

    for (const kf of layer.keyframes) {
      xml += `${indent}  <keyframe frame="${kf.frame}" tween="${kf.tween}" easing="${kf.easing}">\n`;
      xml += `${indent}    ${stripClipHrefs(kf.svgContent)}\n`;
      xml += `${indent}  </keyframe>\n`;
    }

    xml += `${indent}</layer>\n`;
  }
  return xml;
}

/** Serialize the full project state to a .flick XML string */
function buildFlickXml(state: {
  fps: number;
  totalFrames: number;
  width: number;
  height: number;
  layers: AnimationLayer[];
  background: BackgroundSettings;
  clips: MovieClip[];
  exportPath: string | null;
  exportFormat: ExportFormat;
  exportRenderBg: boolean;
  exportWidth: number | null;
  exportHeight: number | null;
}): string {
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<flick version="1" width="${state.width}" height="${state.height}" fps="${state.fps}" frames="${state.totalFrames}"${state.exportPath ? ` export-path="${escXml(state.exportPath)}"` : ''}>\n`;

  // Export settings
  xml += `  <export format="${state.exportFormat}" render-bg="${state.exportRenderBg}"`;
  if (state.exportWidth != null) xml += ` width="${state.exportWidth}"`;
  if (state.exportHeight != null) xml += ` height="${state.exportHeight}"`;
  xml += `/>\n`;

  if (state.background.type === 'image' && state.background.imageData) {
    xml += `  <background type="image"><image-data><![CDATA[${state.background.imageData}]]></image-data></background>\n`;
  } else if (state.background.type === 'video' && state.background.imageData) {
    xml += `  <background type="video" start-time="${state.background.videoStartTime}" audio="${state.background.videoAudio}"><image-data><![CDATA[${state.background.imageData}]]></image-data></background>\n`;
  } else {
    xml += `  <background type="${state.background.type}" color="${escXml(state.background.color)}"/>\n`;
  }

  if (state.clips.length > 0) {
    xml += `  <clips>\n`;
    for (const clip of state.clips) {
      xml += `    <clip id="${escXml(clip.id)}" name="${escXml(clip.name)}" width="${clip.width}" height="${clip.height}" frames="${clip.totalFrames}">\n`;
      xml += serializeLayersXml(clip.layers, '      ');
      xml += `    </clip>\n`;
    }
    xml += `  </clips>\n`;
  }

  xml += serializeLayersXml(state.layers, '  ');

  xml += `</flick>\n`;
  return xml;
}

/** Parse layer elements from a container into AnimationLayer[] */
function parseLayersXml(containerEl: Element, serializer: XMLSerializer): AnimationLayer[] {
  const layers: AnimationLayer[] = [];
  for (const layerEl of Array.from(containerEl.querySelectorAll(':scope > layer'))) {
    const keyframes: Keyframe[] = [];
    for (const kfEl of Array.from(layerEl.querySelectorAll(':scope > keyframe'))) {
      const svgEl = kfEl.querySelector('svg');
      const svgContent = svgEl ? serializer.serializeToString(svgEl) : '';
      keyframes.push({
        frame: Number(kfEl.getAttribute('frame')),
        svgContent,
        tween: (kfEl.getAttribute('tween') || 'linear') as TweenType,
        easing: (kfEl.getAttribute('easing') || 'in-out') as EasingDirection,
      });
    }
    keyframes.sort((a, b) => a.frame - b.frame);

    layers.push({
      id: layerEl.getAttribute('id') || '',
      name: layerEl.getAttribute('name') || '',
      renderVisible: layerEl.getAttribute('render-visible') !== 'false',
      viewportVisible: layerEl.getAttribute('viewport-visible') !== 'false',
      clipLayerId: layerEl.getAttribute('clip') || null,
      maskLayerId: layerEl.getAttribute('mask') || null,
      loop: layerEl.getAttribute('loop') === 'true',
      ghostEndFrame: layerEl.getAttribute('ghost-end-frame') === 'true',
      keyframes,
    });
  }
  return layers;
}

/** Parse a .flick XML string back into project data */
function parseFlickXml(xmlString: string): {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  background: BackgroundSettings;
  layers: AnimationLayer[];
  clips: MovieClip[];
  exportPath: string | null;
  exportFormat: ExportFormat;
  exportRenderBg: boolean;
  exportWidth: number | null;
  exportHeight: number | null;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');
  const root = doc.documentElement;

  const width = Number(root.getAttribute('width'));
  const height = Number(root.getAttribute('height'));
  const fps = Number(root.getAttribute('fps'));
  const totalFrames = Number(root.getAttribute('frames'));
  const exportPath = root.getAttribute('export-path') || null;

  // Export settings
  const exportEl = root.querySelector(':scope > export');
  const exportFormat = ((exportEl?.getAttribute('format') || 'svg') as ExportFormat);
  const exportRenderBg = exportEl ? exportEl.getAttribute('render-bg') !== 'false' : true;
  const rawExW = exportEl?.getAttribute('width');
  const rawExH = exportEl?.getAttribute('height');
  const exportWidth = rawExW ? Number(rawExW) : null;
  const exportHeight = rawExH ? Number(rawExH) : null;

  // Background
  const bgEl = root.querySelector('background');
  let background: BackgroundSettings = { type: 'none', color: '#ffffff', imageData: '', videoStartTime: 0, videoAudio: true };
  if (bgEl) {
    const bgType = (bgEl.getAttribute('type') || 'none') as BackgroundType;
    if (bgType === 'image') {
      const imgData = bgEl.querySelector('image-data');
      background = { type: 'image', color: '#ffffff', imageData: imgData?.textContent ?? '', videoStartTime: 0, videoAudio: true };
    } else if (bgType === 'video') {
      const imgData = bgEl.querySelector('image-data');
      background = {
        type: 'video',
        color: '#ffffff',
        imageData: imgData?.textContent ?? '',
        videoStartTime: parseFloat(bgEl.getAttribute('start-time') || '0'),
        videoAudio: bgEl.getAttribute('audio') !== 'false',
      };
    } else {
      background = { type: bgType, color: bgEl.getAttribute('color') || '#ffffff', imageData: '', videoStartTime: 0, videoAudio: true };
    }
  }

  // Clips
  const serializer = new XMLSerializer();
  const clips: MovieClip[] = [];
  const clipsEl = root.querySelector(':scope > clips');
  if (clipsEl) {
    for (const clipEl of Array.from(clipsEl.querySelectorAll(':scope > clip'))) {
      clips.push({
        id: clipEl.getAttribute('id') || '',
        name: clipEl.getAttribute('name') || '',
        width: Number(clipEl.getAttribute('width')),
        height: Number(clipEl.getAttribute('height')),
        totalFrames: Number(clipEl.getAttribute('frames')),
        layers: parseLayersXml(clipEl, serializer),
      });
    }
  }

  // Layers (direct children of root, not inside clips)
  const layers = parseLayersXml(root, serializer);

  return { width, height, fps, totalFrames, background, layers, clips, exportPath, exportFormat, exportRenderBg, exportWidth, exportHeight };
}

const CLIP_PADDING = 20;

/** Compute bounding box of a group element within an SVG string */
function computeGroupBBox(fullSvgContent: string, groupId: string):
  { x: number; y: number; width: number; height: number } | null {
  const container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;visibility:hidden';
  document.body.appendChild(container);
  try {
    container.innerHTML = fullSvgContent;
    const el = container.querySelector(`#${CSS.escape(groupId)}`) as SVGGraphicsElement | null;
    if (!el) return null;
    const bbox = el.getBBox();
    return { x: bbox.x - CLIP_PADDING, y: bbox.y - CLIP_PADDING, width: bbox.width + CLIP_PADDING * 2, height: bbox.height + CLIP_PADDING * 2 };
  } finally {
    document.body.removeChild(container);
  }
}

// ── Store ─────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>((set, get) => {

  /** Snapshot current layers + clips onto the undo stack, clear redo */
  function pushUndo() {
    if (isClipMode) return; // undo is managed by the main window
    const { layers, clips, undoStack } = get();
    const newStack = [...undoStack, { layers, clips }].slice(-MAX_UNDO);
    set({ undoStack: newStack, redoStack: [], canUndo: true, canRedo: false, dirty: true });
  }

  /** Broadcast current clip state to all open clip editor windows */
  function broadcastAllClipStates() {
    const state = get();
    const meta = {
      canUndo: state.canUndo,
      canRedo: state.canRedo,
      dirty: state.dirty,
      fps: state.fps,
      projectPath: state.projectPath,
    };
    for (const clip of state.clips) {
      window.api.broadcastClipState(clip.id, {
        layers: clip.layers,
        width: clip.width,
        height: clip.height,
        totalFrames: clip.totalFrames,
        name: clip.name,
        clips: state.clips,
      }, meta);
    }
  }

  /**
   * Build the multi-layer SVG document for Inkscape editing.
   * All layers are sent as real Inkscape layers. Layers with a keyframe at
   * the given frame are unlocked; others are locked (sodipodi:insensitive).
   * Returns the SVG string, filename, and a map of layer content for diffing.
   */
  function buildEditingSvg(state: ProjectState, frame: number) {
    const knownState = new Map<string, string>();

    let layersSvg = '';

    // Background context layer (bottommost, always locked)
    if (state.background.type === 'solid') {
      layersSvg += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] background" sodipodi:insensitive="true">\n`;
      layersSvg += `    <rect width="${state.width}" height="${state.height}" fill="${state.background.color}" />\n`;
      layersSvg += `  </g>\n`;
    } else if (state.background.type === 'image' && state.background.imageData) {
      layersSvg += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] background" sodipodi:insensitive="true">\n`;
      layersSvg += `    <image href="${state.background.imageData}" width="${state.width}" height="${state.height}" />\n`;
      layersSvg += `  </g>\n`;
    } else if (state.background.type === 'video' && state.videoSnapshot) {
      layersSvg += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] background" sodipodi:insensitive="true">\n`;
      layersSvg += `    <image href="${state.videoSnapshot}" width="${state.width}" height="${state.height}" />\n`;
      layersSvg += `  </g>\n`;
    }

    // Render layers in reverse order (bottom-up in z-order, matching compositor)
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      if (!layer.viewportVisible) continue;

      const hasKeyframeAtFrame = layer.keyframes.some((kf) => kf.frame === frame);

      // Render the layer's interpolated content at this frame
      // Clip references are NOT resolved here — they stay as <image data-flick-clip="...">
      // with base64 hrefs already embedded. syncClipsToInkscape handles clip panel registration.
      const inner = renderLayer(layer, frame, state.totalFrames);

      const locked = !hasKeyframeAtFrame;
      const lockAttr = locked ? ' sodipodi:insensitive="true"' : '';
      layersSvg += `  <g inkscape:groupmode="layer" inkscape:label="${layer.id}"${lockAttr}>\n`;
      layersSvg += inner ? `    ${inner}\n` : '';
      layersSvg += `  </g>\n`;

      // Store the content for diffing (normalize what we sent)
      const layerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${inner ? inner.trim() : ''}\n</svg>`;
      const normalizedSent = normalizeSvgForDiff(layerSvg);
      knownState.set(layer.id, normalizedSent);


    }

    const flickName = state.projectPath ? state.projectPath.split(/[\\/]/).pop()! : 'Untitled Flick Project';
    const inkscapeFilename = `${flickName}-${String(frame).padStart(3, '0')}`;

    const workingSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="${state.width}" height="${state.height}"
     viewBox="0 0 ${state.width} ${state.height}">
${layersSvg}</svg>`;

    return { workingSvg, inkscapeFilename, knownState };
  }

  /** Clean up Inkscape listeners and clear editing state */
  function clearEditing() {
    const state = get();
    if (!state.editingKeyframe) return;

    for (const key of ['_saveCleanup', '_closeCleanup', '_undoCleanup', '_redoCleanup', '_nclipCleanup', '_requestSaveCleanup']) {
      const cleanup = (state as any)[key];
      if (cleanup) cleanup();
    }

    set({ editingKeyframe: null, lastKnownInkscapeState: new Map() });
  }

  return {
  id: 'root',
  name: 'Untitled',
  projectPath: null,
  exportPath: null,
  exportFormat: 'svg' as ExportFormat,
  exportRenderBg: true,
  exportWidth: null,
  exportHeight: null,
  dirty: false,

  width: 1920,
  height: 1080,
  fps: 24,
  totalFrames: 60,
  background: { type: 'none', color: '#ffffff', imageData: '', videoStartTime: 0, videoAudio: true },

  clips: [] as MovieClip[],

  layers: [{
    id: 'layer-1',
    renderVisible: true,
    viewportVisible: true,
    clipLayerId: null,
    maskLayerId: null,
    loop: false,
    ghostEndFrame: false,
    keyframes: [],
  }],
  selectedLayerId: 'layer-1',
  currentFrame: 0,

  selection: null,
  clipboard: null,

  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  canvasContainerWidth: 0,
  canvasContainerHeight: 0,

  compositedSvg: '',
  videoSnapshot: '',
  editingKeyframe: null,
  lastKnownInkscapeState: new Map<string, string>(),

  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,

  playing: false,

  // ── Undo / Redo ─────────────────────────────────────────

  undo: () => {
    if (isClipMode) {
      window.api.requestClipUndo(editingClipId!);
      return;
    }
    const { undoStack, layers, clips, editingKeyframe } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    set((s) => ({
      layers: prev.layers,
      clips: prev.clips,
      undoStack: newUndoStack,
      redoStack: [...s.redoStack, { layers, clips }],
      canUndo: newUndoStack.length > 0,
      canRedo: true,
      dirty: true,
    }));
    get().recomposite();
    if (editingKeyframe) {
      get().syncClipsToInkscape();
      get().reloadInkscapeDocument();
    }
    broadcastAllClipStates();
  },

  redo: () => {
    if (isClipMode) {
      window.api.requestClipRedo(editingClipId!);
      return;
    }
    const { redoStack, layers, clips, editingKeyframe } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    set((s) => ({
      layers: next.layers,
      clips: next.clips,
      undoStack: [...s.undoStack, { layers, clips }],
      redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
      dirty: true,
    }));
    get().recomposite();
    if (editingKeyframe) {
      get().syncClipsToInkscape();
      get().reloadInkscapeDocument();
    }
    broadcastAllClipStates();
  },

  // ── Project lifecycle ───────────────────────────────────

  newProject: () => {
    clearEditing();
    set({
      id: 'root',
      name: 'Untitled',
      projectPath: null,
      exportPath: null,
      exportFormat: 'svg' as ExportFormat,
      exportRenderBg: true,
      exportWidth: null,
      exportHeight: null,
      dirty: false,
      width: 1920,
      height: 1080,
      fps: 24,
      totalFrames: 60,
      background: { type: 'none', color: '#ffffff', imageData: '', videoStartTime: 0, videoAudio: true },
      clips: [],
      layers: [{
        id: 'layer-1',
        renderVisible: true,
        viewportVisible: true,
        clipLayerId: null,
        maskLayerId: null,
        loop: false,
        ghostEndFrame: false,
        keyframes: [],
      }],
      selectedLayerId: 'layer-1',
      currentFrame: 0,
      compositedSvg: '',
      videoSnapshot: '',
      editingKeyframe: null,
      lastKnownInkscapeState: new Map(),
      selection: null,
      clipboard: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    });
  },

  openProject: async (filePath: string) => {
    const raw = await window.api.readFile(filePath);
    const parsed = parseFlickXml(raw);

    // Re-inject clip hrefs stripped during save
    const layers = injectClipHrefsInLayers(parsed.layers, parsed.clips);
    const clips = parsed.clips.map((c) => ({
      ...c,
      layers: injectClipHrefsInLayers(c.layers, parsed.clips),
    }));

    set({
      projectPath: filePath,
      exportPath: parsed.exportPath,
      exportFormat: parsed.exportFormat,
      exportRenderBg: parsed.exportRenderBg,
      exportWidth: parsed.exportWidth,
      exportHeight: parsed.exportHeight,
      dirty: false,
      width: parsed.width,
      height: parsed.height,
      fps: parsed.fps,
      totalFrames: parsed.totalFrames,
      background: parsed.background,
      clips,
      layers,
      selectedLayerId: layers.length > 0 ? layers[0].id : null,
      currentFrame: 0,
      compositedSvg: '',
      videoSnapshot: '',
      editingKeyframe: null,
      lastKnownInkscapeState: new Map(),
      selection: null,
      clipboard: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    });

    get().recomposite();
  },

  saveProject: async () => {
    if (isClipMode) {
      window.api.requestClipSave();
      return;
    }
    let { projectPath } = get();
    if (!projectPath) {
      const result = await window.api.showSaveDialog({
        title: 'Save project',
        filters: [{ name: 'Flick Project', extensions: ['flick'] }],
      });
      if (result.canceled || !result.filePath) return;
      projectPath = result.filePath;
      set({ projectPath });
    }
    await window.api.writeFile(projectPath, buildFlickXml(get()));
    set({ dirty: false });
    window.api.inkscapeUndirty();
  },

  // ── Layer actions ───────────────────────────────────────

  addLayer: async () => {
    const state = get();
    pushUndo();

    let id = 'layer-1';
    let counter = 1;
    while (state.layers.some((l) => l.id === id)) {
      id = `layer-${++counter}`;
    }

    const newLayer: AnimationLayer = {
      id,
      name: '',
      renderVisible: true,
      viewportVisible: true,
      clipLayerId: null,
      maskLayerId: null,
      loop: false,
      ghostEndFrame: false,
      keyframes: [],
    };

    set((s) => ({
      layers: [newLayer, ...s.layers],
      selectedLayerId: id,
    }));
  },

  removeLayer: (id: string) => {
    pushUndo();
    set((s) => {
      const remaining = s.layers.filter((l) => l.id !== id);
      return {
        layers: remaining,
        selectedLayerId: s.selectedLayerId === id
          ? (remaining[0]?.id ?? null)
          : s.selectedLayerId,
        selection: null,
      };
    });
    get().recomposite();
  },

  renameLayer: (id: string, name: string) => {
    const layer = get().layers.find((l) => l.id === id);
    if (!layer || layer.name === name) return;
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) => l.id === id ? { ...l, name } : l),
      dirty: true,
    }));
  },

  moveLayer: (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    pushUndo();
    set((s) => {
      const newLayers = [...s.layers];
      const [moved] = newLayers.splice(fromIdx, 1);
      newLayers.splice(toIdx, 0, moved);
      return { layers: newLayers };
    });
    get().recomposite();
  },

  toggleRenderVisible: (id: string) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, renderVisible: !l.renderVisible } : l
      ),
    }));
  },

  toggleViewportVisible: (id: string) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, viewportVisible: !l.viewportVisible } : l
      ),
    }));
    get().recomposite();
  },

  setLayerClip: (id: string, clipLayerId: string | null) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, clipLayerId } : l
      ),
    }));
    get().recomposite();
  },

  setLayerMask: (id: string, maskLayerId: string | null) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, maskLayerId } : l
      ),
    }));
    get().recomposite();
  },

  setLayerLoop: (id: string, loop: boolean) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, loop } : l
      ),
    }));
    get().recomposite();
  },

  setLayerGhostEndFrame: (id: string, ghost: boolean) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, ghostEndFrame: ghost } : l
      ),
    }));
    get().recomposite();
  },

  selectLayer: (id: string | null) => {
    set({ selectedLayerId: id, selection: null });
  },

  // ── Keyframe actions ────────────────────────────────────

  addKeyframe: async (layerId: string, frame: number, fromReference = false) => {
    const state = get();
    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;

    if (layer.keyframes.some((kf) => kf.frame === frame)) return;

    pushUndo();

    let svgContent: string;
    if (fromReference) {
      const inner = renderLayer(layer, frame, state.totalFrames);
      if (inner) {
        svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${inner}\n</svg>`;
      } else {
        svgContent = blankSvg(state.width, state.height);
      }
    } else {
      svgContent = blankSvg(state.width, state.height);
    }

    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        const newKeyframes = [...l.keyframes, { frame, svgContent, tween: 'linear' as TweenType, easing: 'in-out' as EasingDirection }]
          .sort((a, b) => a.frame - b.frame);
        return { ...l, keyframes: newKeyframes };
      }),
    }));

    get().recomposite();
  },

  removeKeyframe: (layerId: string, frame: number) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          keyframes: l.keyframes.filter((kf) => kf.frame !== frame),
        };
      }),
    }));
    get().recomposite();
  },

  setKeyframeTween: (layerId: string, frame: number, tween: TweenType) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          keyframes: l.keyframes.map((kf) =>
            kf.frame === frame ? { ...kf, tween } : kf
          ),
        };
      }),
    }));
    get().recomposite();
  },

  setKeyframeEasing: (layerId: string, frame: number, easing: EasingDirection) => {
    pushUndo();
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          keyframes: l.keyframes.map((kf) =>
            kf.frame === frame ? { ...kf, easing } : kf
          ),
        };
      }),
    }));
    get().recomposite();
  },

  // ── Selection / Clipboard ───────────────────────────────

  setSelectionAnchor: (layerIdx: number, frame: number) => {
    set({
      selection: {
        anchorLayerIdx: layerIdx,
        anchorFrame: frame,
        endLayerIdx: layerIdx,
        endFrame: frame,
      },
    });
  },

  setSelectionEnd: (layerIdx: number, frame: number) => {
    set((s) => {
      if (!s.selection) return {};
      return {
        selection: {
          ...s.selection,
          endLayerIdx: layerIdx,
          endFrame: frame,
        },
      };
    });
  },

  commitSelection: () => {
    const { selection, layers } = get();
    if (!selection) return;

    const rect = selectionRect(selection);
    const isSingleCell =
      rect.minLayerIdx === rect.maxLayerIdx &&
      rect.minFrame === rect.maxFrame;

    if (isSingleCell) {
      // Single click: move scrubber and select that layer
      set({
        currentFrame: rect.minFrame,
        selectedLayerId: layers[rect.minLayerIdx]?.id ?? null,
      });
      get().recomposite();
    } else {
      // Multi-select: set selectedLayerId to anchor layer, don't move scrubber
      set({
        selectedLayerId: layers[selection.anchorLayerIdx]?.id ?? null,
      });
    }
  },

  clearSelection: () => {
    set({ selection: null });
  },

  copySelection: () => {
    const { selection, layers } = get();
    if (!selection) return;

    const rect = selectionRect(selection);
    const layerCount = rect.maxLayerIdx - rect.minLayerIdx + 1;
    const frameCount = rect.maxFrame - rect.minFrame + 1;

    const cells: (ClipboardCell | null)[][] = [];
    for (let li = 0; li < layerCount; li++) {
      const layer = layers[rect.minLayerIdx + li];
      const row: (ClipboardCell | null)[] = [];
      for (let fi = 0; fi < frameCount; fi++) {
        const frame = rect.minFrame + fi;
        const kf = layer?.keyframes.find((k) => k.frame === frame);
        row.push(kf ? { svgContent: kf.svgContent, tween: kf.tween, easing: kf.easing } : null);
      }
      cells.push(row);
    }

    set({ clipboard: { cells, layerCount, frameCount } });
  },

  pasteAtSelection: () => {
    const { selection, clipboard, totalFrames } = get();
    if (!selection || !clipboard) return;

    const rect = selectionRect(selection);
    const startLayerIdx = rect.minLayerIdx;
    const startFrame = rect.minFrame;

    pushUndo();

    set((s) => {
      const newLayers = s.layers.map((layer, layerIdx) => {
        const clipLayerOffset = layerIdx - startLayerIdx;
        if (clipLayerOffset < 0 || clipLayerOffset >= clipboard.layerCount) return layer;

        const clipRow = clipboard.cells[clipLayerOffset];
        let newKeyframes = [...layer.keyframes];

        for (let fi = 0; fi < clipboard.frameCount; fi++) {
          const targetFrame = startFrame + fi;
          if (targetFrame >= totalFrames) break;

          const cell = clipRow[fi];
          if (cell === null) continue;

          // Remove existing keyframe at target frame if any
          newKeyframes = newKeyframes.filter((kf) => kf.frame !== targetFrame);
          // Add the pasted keyframe with tween/easing from clipboard
          newKeyframes.push({
            frame: targetFrame,
            svgContent: cell.svgContent,
            tween: cell.tween,
            easing: cell.easing,
          });
        }

        newKeyframes.sort((a, b) => a.frame - b.frame);
        return { ...layer, keyframes: newKeyframes };
      });

      return { layers: newLayers };
    });

    get().recomposite();
  },

  deleteSelection: () => {
    const { selection, layers } = get();
    if (!selection) return;

    const rect = selectionRect(selection);

    // Check if there are any keyframes to delete in the selection
    let hasAny = false;
    for (let li = rect.minLayerIdx; li <= rect.maxLayerIdx; li++) {
      const layer = layers[li];
      if (!layer) continue;
      if (layer.keyframes.some((kf) => kf.frame >= rect.minFrame && kf.frame <= rect.maxFrame)) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) return;

    pushUndo();

    set((s) => ({
      layers: s.layers.map((layer, idx) => {
        if (idx < rect.minLayerIdx || idx > rect.maxLayerIdx) return layer;
        return {
          ...layer,
          keyframes: layer.keyframes.filter(
            (kf) => kf.frame < rect.minFrame || kf.frame > rect.maxFrame
          ),
        };
      }),
    }));

    get().recomposite();
  },

  reloadInkscapeDocument: async () => {
    const state = get();
    if (!state.editingKeyframe) return;
    const api = window.api;

    const { frame } = state.editingKeyframe;
    const { workingSvg, inkscapeFilename, knownState } = buildEditingSvg(state, frame);

    set({ lastKnownInkscapeState: knownState });

    try {
      await api.inkscapeLoad(inkscapeFilename, workingSvg);
    } catch {
      clearEditing();
    }
  },

  // ── Inkscape editing (pipe mode) ─────────────────────────

  startEditing: async (frame: number) => {
    const state = get();
    const api = window.api;

    // Stop playback before editing
    if (state.playing) get().stop();

    // Clean up previous editing session listeners
    if (state.editingKeyframe) {
      clearEditing();
    }

    const { workingSvg, inkscapeFilename, knownState } = buildEditingSvg(state, frame);

    // Set up pipe-mode listeners
    const saveCleanup = api.onInkscapeSaved((_filename: string, svgContent: string) => {
      get().handleInkscapeSave(svgContent);
    });
    (get() as any)._saveCleanup = saveCleanup;

    const closeCleanup = api.onInkscapeWindowClosed(() => {
      clearEditing();
    });
    (get() as any)._closeCleanup = closeCleanup;

    const undoCleanup = api.onInkscapeUndo(() => {
      get().undo();
    });
    (get() as any)._undoCleanup = undoCleanup;

    const redoCleanup = api.onInkscapeRedo(() => {
      get().redo();
    });
    (get() as any)._redoCleanup = redoCleanup;

    const nclipCleanup = api.onInkscapeNClip((elementId: string) => {
      get().handleNClip(elementId);
    });
    (get() as any)._nclipCleanup = nclipCleanup;

    const requestSaveCleanup = api.onInkscapeRequestSave(() => {
      get().saveProject();
    });
    (get() as any)._requestSaveCleanup = requestSaveCleanup;

    set({
      editingKeyframe: { frame },
      lastKnownInkscapeState: knownState,
    });

    try {
      await api.inkscapeLoad(inkscapeFilename, workingSvg);
      get().syncClipsToInkscape();
    } catch {
      clearEditing();
    }
  },

  handleInkscapeSave: async (svgContent: string) => {
    const state = get();
    if (!state.editingKeyframe) return;

    const { frame } = state.editingKeyframe;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';
    const SODIPODI_NS = 'http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd';

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgContent, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return;

    const serializer = new XMLSerializer();
    function serializeChildren(el: Element): string {
      let out = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        out += serializer.serializeToString(el.childNodes[i]);
      }
      // Strip svg: namespace prefix (Inkscape pipe-mode uses it)
      return out.replace(/<(\/?)svg:/g, '<$1').replace(/\s+xmlns:svg="[^"]*"/g, '');
    }

    // Remove sodipodi:namedview
    for (const nv of Array.from(doc.getElementsByTagNameNS(SODIPODI_NS, 'namedview'))) {
      nv.parentNode?.removeChild(nv);
    }

    // Remove inkscape:perspective (auto-generated on every open)
    for (const p of Array.from(doc.getElementsByTagNameNS(INKSCAPE_NS, 'perspective'))) {
      p.parentNode?.removeChild(p);
    }

    // Remove [ctx] background layer
    for (const g of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'g'))) {
      const label = g.getAttributeNS(INKSCAPE_NS, 'label');
      if (label && label.startsWith('[ctx]')) {
        g.parentNode?.removeChild(g);
      }
    }

    // Collect defs content (skip empty defs)
    let defsContent = '';
    for (const defs of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'defs'))) {
      if (defs.childElementCount > 0) {
        defsContent += serializeChildren(defs);
      }
    }
    const defsBlock = defsContent.trim() ? `<defs>${defsContent.trim()}</defs>\n` : '';

    // Extract content from each Inkscape layer and diff against known state
    const newKnownState = new Map(state.lastKnownInkscapeState);
    let anyChanged = false;
    let updatedLayers = state.layers;

    for (const g of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'g'))) {
      if (g.getAttributeNS(INKSCAPE_NS, 'groupmode') !== 'layer') continue;
      const layerId = g.getAttributeNS(INKSCAPE_NS, 'label');
      if (!layerId || layerId.startsWith('[ctx]')) continue;

      const innerContent = serializeChildren(g);
      const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${defsBlock}${innerContent.trim()}\n</svg>`;

      // Normalize and compare against what Inkscape had before
      const normalized = normalizeSvgForDiff(cleanSvg);
      const previousNormalized = state.lastKnownInkscapeState.get(layerId) || '';

      if (normalized === previousNormalized) {
        // Unchanged — skip
        continue;
      }

      anyChanged = true;
      newKnownState.set(layerId, normalized);

      const layer = updatedLayers.find((l) => l.id === layerId);
      if (!layer) continue;

      const existingKf = layer.keyframes.find((kf) => kf.frame === frame);

      if (existingKf) {
        // Update existing keyframe
        updatedLayers = updatedLayers.map((l) => {
          if (l.id !== layerId) return l;
          return {
            ...l,
            keyframes: l.keyframes.map((kf) =>
              kf.frame === frame ? { ...kf, svgContent: cleanSvg } : kf
            ),
          };
        });
      } else {
        // Create new keyframe — inherit tween/easing from nearest prior keyframe
        const nearest = findNearestKeyframe(layer.keyframes, frame);
        const newKf: Keyframe = {
          frame,
          svgContent: cleanSvg,
          tween: nearest?.tween || 'linear',
          easing: nearest?.easing || 'in-out',
        };
        updatedLayers = updatedLayers.map((l) => {
          if (l.id !== layerId) return l;
          const kfs = [...l.keyframes, newKf].sort((a, b) => a.frame - b.frame);
          return { ...l, keyframes: kfs };
        });
      }
    }

    if (anyChanged) {
      pushUndo();
      set({ dirty: true, layers: updatedLayers });
      // Rebuild known state from the updated layers so staleness check
      // in recomposite sees the same normalized content we'd send now
      const { knownState: freshKnown } = buildEditingSvg(get(), frame);
      set({ lastKnownInkscapeState: freshKnown });
      get().recomposite();
    } else {
      // Even if nothing changed visually, update the known state
      set({ lastKnownInkscapeState: newKnownState });
    }

    window.api.inkscapeDirty();
  },

  // ── Timeline / Canvas ───────────────────────────────────

  setCurrentFrame: (frame: number) => {
    if (get().playing) get().stop();
    set({ currentFrame: frame });
    get().recomposite();
  },

  setCanvasZoom: (zoom: number) => set({ canvasZoom: Math.max(0.1, Math.min(10, zoom)) }),
  setCanvasPan: (x: number, y: number) => set({ canvasPanX: x, canvasPanY: y }),
  resetCanvasView: () => {
    const { width, height, canvasContainerWidth, canvasContainerHeight } = get();
    if (canvasContainerWidth === 0 || canvasContainerHeight === 0) {
      set({ canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 });
      return;
    }
    const padding = 40;
    const zoom = Math.min(
      (canvasContainerWidth - padding * 2) / width,
      (canvasContainerHeight - padding * 2) / height,
    );
    set({ canvasZoom: Math.max(0.1, Math.min(10, zoom)), canvasPanX: 0, canvasPanY: 0 });
  },
  setCanvasZoom100: () => set({ canvasZoom: 1, canvasPanX: 0, canvasPanY: 0 }),
  setCanvasContainerSize: (w: number, h: number) => set({ canvasContainerWidth: w, canvasContainerHeight: h }),

  setProjectDimensions: (width: number, height: number) => set({ width, height, dirty: true }),
  setFps: (fps: number) => set({ fps, dirty: true }),
  setTotalFrames: (totalFrames: number) => set({ totalFrames, dirty: true }),
  setBackground: (bg: Partial<BackgroundSettings>) => set((s) => ({ background: { ...s.background, ...bg }, dirty: true })),
  setVideoSnapshot: (dataUrl: string) => set({ videoSnapshot: dataUrl }),
  setExportPath: (path: string | null) => {
    if (path === get().exportPath) return;
    pushUndo();
    set({ exportPath: path, dirty: true });
  },
  setExportFormat: (format: ExportFormat) => set({ exportFormat: format, dirty: true }),
  setExportRenderBg: (renderBg: boolean) => set({ exportRenderBg: renderBg, dirty: true }),
  setExportWidth: (width: number | null) => set({ exportWidth: width, dirty: true }),
  setExportHeight: (height: number | null) => set({ exportHeight: height, dirty: true }),

  // ── Playback ────────────────────────────────────────────

  play: () => {
    const { playing, currentFrame } = get();
    if (playing) return;
    set({ playing: true });

    const startTime = performance.now();
    const startFrame = currentFrame;
    const tick = (now: number) => {
      const state = get();
      if (!state.playing) return;
      const elapsed = now - startTime;
      const targetFrame = (startFrame + Math.floor(elapsed / (1000 / state.fps))) % state.totalFrames;
      if (targetFrame !== state.currentFrame) {
        set({ currentFrame: targetFrame });
        state.recomposite();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  stop: () => {
    set({ playing: false });
  },

  // ── Movie Clips ──────────────────────────────────────────

  handleNClip: (elementId: string) => {
    const state = get();
    if (!state.editingKeyframe) return;
    const api = window.api;

    const { frame } = state.editingKeyframe;

    // Find which layer contains the element with this ID
    let layerId: string | null = null;
    let kf: Keyframe | null = null;
    for (const layer of state.layers) {
      const candidate = layer.keyframes.find((k) => k.frame === frame);
      if (!candidate) continue;
      if (candidate.svgContent.includes(`id="${elementId}"`)) {
        layerId = layer.id;
        kf = candidate;
        break;
      }
    }
    if (!layerId || !kf) return;

    // Compute bounding box
    const bbox = computeGroupBBox(kf.svgContent, elementId);
    if (!bbox || bbox.width === 0 || bbox.height === 0) return;

    // Auto-increment clip ID/name
    let clipNum = 1;
    while (state.clips.some((c) => c.id === `clip-${clipNum}`)) clipNum++;
    const clipId = `clip-${clipNum}`;
    const clipName = `Clip ${clipNum}`;

    // Parse the SVG to extract the group and defs
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const parser = new DOMParser();
    const doc = parser.parseFromString(kf.svgContent, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return;

    const groupEl = doc.getElementById(elementId);
    if (!groupEl) return;

    const serializer = new XMLSerializer();
    function serializeChildren(el: Element): string {
      let out = '';
      for (let i = 0; i < el.childNodes.length; i++) {
        out += serializer.serializeToString(el.childNodes[i]);
      }
      return out.replace(/<(\/?)svg:/g, '<$1').replace(/\s+xmlns:svg="[^"]*"/g, '');
    }

    // Collect defs
    let defsContent = '';
    for (const defs of Array.from(doc.getElementsByTagNameNS(SVG_NS, 'defs'))) {
      if (defs.childElementCount > 0) {
        defsContent += serializeChildren(defs);
      }
    }

    // Extract group children
    const groupChildren = serializeChildren(groupEl);

    // Build clip SVG — normalize coordinates to origin (0,0)
    const defsBlock = defsContent.trim() ? `<defs>${defsContent.trim()}</defs>\n` : '';
    const clipSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bbox.width}" height="${bbox.height}" viewBox="0 0 ${bbox.width} ${bbox.height}">\n${defsBlock}<g id="g1" transform="translate(${-bbox.x}, ${-bbox.y})">${groupChildren.trim()}</g>\n</svg>`;

    // Create MovieClip
    const newClip: MovieClip = {
      id: clipId,
      name: clipName,
      width: bbox.width,
      height: bbox.height,
      totalFrames: 1,
      layers: [{
        id: 'layer-1',
        name: '',
        renderVisible: true,
        viewportVisible: true,
        clipLayerId: null,
        maskLayerId: null,
        loop: false,
        ghostEndFrame: false,
        keyframes: [{
          frame: 0,
          svgContent: clipSvg,
          tween: 'linear' as TweenType,
          easing: 'in-out' as EasingDirection,
        }],
      }],
    };

    // Replace group with image placeholder in the DOM
    const b64 = btoa(unescape(encodeURIComponent(clipSvg)));
    const imageEl = doc.createElementNS(SVG_NS, 'image');
    imageEl.setAttribute('data-flick-clip', clipId);
    imageEl.setAttribute('href', `data:image/svg+xml;base64,${b64}`);
    imageEl.setAttribute('x', String(bbox.x));
    imageEl.setAttribute('y', String(bbox.y));
    imageEl.setAttribute('width', String(bbox.width));
    imageEl.setAttribute('height', String(bbox.height));
    groupEl.parentNode?.replaceChild(imageEl, groupEl);

    // Re-serialize the keyframe SVG (serializeChildren includes existing defs)
    const svgRoot = doc.documentElement;
    const newSvgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${serializeChildren(svgRoot).trim()}\n</svg>`;

    // Register image placeholder with Inkscape's Clip Panel
    const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${bbox.width}" height="${bbox.height}" viewBox="0 0 ${bbox.width} ${bbox.height}">\n<image data-flick-clip="${clipId}" href="data:image/svg+xml;base64,${b64}" width="${bbox.width}" height="${bbox.height}" />\n</svg>`;

    if (isClipMode) {
      // In clip mode the store is a local mirror — forward clip creation to the main window,
      // which owns the canonical state.clips and will broadcast the updated clip back here.
      api.sendNClipToMain(editingClipId!, {
        newClip,
        newSvgContent,
        layerId,
        frame,
        clipRegSvg: imageSvg,
        clipName,
      });
      return;
    }

    // Update store — no pushUndo() here; the preceding SAVE already pushed
    // the pre-group state, so undo skips the intermediate grouped state.
    set((s) => ({
      clips: [...s.clips, newClip],
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          keyframes: l.keyframes.map((k) =>
            k.frame === frame ? { ...k, svgContent: newSvgContent } : k
          ),
        };
      }),
    }));

    api.inkscapeClip(clipId, clipName, imageSvg);
    api.inkscapeDirty();
    get().reloadInkscapeDocument();
    get().recomposite();
  },

  syncClipsToInkscape: () => {
    const { clips, currentFrame } = get();
    const api = window.api;
    for (const clip of clips) {
      // In clip mode, exclude the currently-editing clip to prevent circular refs
      if (isClipMode && clip.id === editingClipId) continue;
      if (clip.layers.length === 0) continue;

      // Render the clip at the frame it would be showing on the current timeline position
      const clipFrame = clip.totalFrames > 0
        ? currentFrame % clip.totalFrames
        : 0;
      const clipContent = compositeFrame(
        clip.layers, clipFrame, clip.width, clip.height, 'viewport',
        clip.totalFrames, clips,
      );
      const fullSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${clip.width}" height="${clip.height}" viewBox="0 0 ${clip.width} ${clip.height}">${clipContent}</svg>`;
      const b64 = btoa(unescape(encodeURIComponent(fullSvg)));
      const imageSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${clip.width}" height="${clip.height}" viewBox="0 0 ${clip.width} ${clip.height}">\n<image data-flick-clip="${clip.id}" href="data:image/svg+xml;base64,${b64}" width="${clip.width}" height="${clip.height}" />\n</svg>`;
      api.inkscapeClip(clip.id, clip.name, imageSvg);
    }
  },

  renameClip: (id: string, name: string) => {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip || clip.name === name) return;
    pushUndo();
    set((s) => ({
      clips: s.clips.map((c) => c.id === id ? { ...c, name } : c),
    }));
    get().syncClipsToInkscape();
    if (get().editingKeyframe) window.api.inkscapeDirty();
  },

  duplicateClip: (id: string) => {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return;
    pushUndo();

    let clipNum = 1;
    while (get().clips.some((c) => c.id === `clip-${clipNum}`)) clipNum++;
    const newId = `clip-${clipNum}`;
    const newName = `${clip.name} Copy`;

    const newClip: MovieClip = {
      ...clip,
      id: newId,
      name: newName,
      layers: clip.layers.map((l) => ({
        ...l,
        keyframes: l.keyframes.map((kf) => ({ ...kf })),
      })),
    };

    set((s) => ({ clips: [...s.clips, newClip] }));

    get().syncClipsToInkscape();
    if (get().editingKeyframe) window.api.inkscapeDirty();
  },

  deleteClip: (id: string) => {
    if (!get().clips.some((c) => c.id === id)) return;
    window.api.closeClipEditor(id);
    pushUndo();

    // Remove <image data-flick-clip="id"> from all keyframe SVGs
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    function scrubClipRefs(svgContent: string): string {
      const doc = parser.parseFromString(svgContent, 'image/svg+xml');
      if (doc.querySelector('parsererror')) return svgContent;
      const images = Array.from(doc.querySelectorAll(`image[data-flick-clip="${id}"]`));
      if (images.length === 0) return svgContent;
      for (const img of images) img.parentNode?.removeChild(img);
      return serializer.serializeToString(doc.documentElement);
    }

    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      layers: s.layers.map((l) => ({
        ...l,
        keyframes: l.keyframes.map((kf) => ({
          ...kf,
          svgContent: scrubClipRefs(kf.svgContent),
        })),
      })),
    }));
    window.api.inkscapeUclip(id);
    if (get().editingKeyframe) {
      window.api.inkscapeDirty();
      get().reloadInkscapeDocument();
    }
    get().recomposite();
  },

  openClipEditor: (clipId: string) => {
    const state = get();
    const clip = state.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const folderName = state.projectPath ? state.projectPath.split(/[\\/]/).pop() : 'Untitled';
    const title = `${folderName} — [${clip.name}] — Flick`;
    window.api.openClipEditor(clipId, title);
  },

  // ── Compositor ──────────────────────────────────────────

  recomposite: () => {
    const { layers, currentFrame, width, height, totalFrames, clips, editingKeyframe, lastKnownInkscapeState } = get();
    const combined = compositeFrame(layers, currentFrame, width, height, 'viewport', totalFrames, clips);
    set({ compositedSvg: combined });

    if (editingKeyframe) {
      if (clips.length > 0) {
        get().syncClipsToInkscape();
      }

      // Staleness detection: rebuild what we'd send to Inkscape now
      // and compare against what Inkscape currently has
      if (lastKnownInkscapeState.size > 0) {
        const { knownState: freshState } = buildEditingSvg(get(), editingKeyframe.frame);
        let stale = false;
        for (const [layerId, freshNorm] of freshState) {
          const known = lastKnownInkscapeState.get(layerId) || '';
          if (known && freshNorm !== known) {
            stale = true;
            break;
          }
        }
        if (stale) {
          get().reloadInkscapeDocument();
        }
      }
    }
  },
};
});
