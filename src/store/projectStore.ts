import { create } from 'zustand';
import { compositeFrame, renderLayer } from '../lib/compositor';

// ── Data Model ────────────────────────────────────────────

export type TweenType = 'discrete' | 'linear' | 'quadratic' | 'cubic'
  | 'exponential' | 'circular' | 'elastic' | 'bounce';
export type EasingDirection = 'in' | 'out' | 'in-out';

export type BackgroundType = 'none' | 'solid' | 'image';
export interface BackgroundSettings {
  type: BackgroundType;
  color: string;       // hex, used when type === 'solid'
  imageData: string;   // data URL, used when type === 'image'
}

export interface Keyframe {
  frame: number;        // 0-indexed, matches kf_NNN.svg
  svgContent: string;   // Full SVG loaded in memory
  tween: TweenType;
  easing: EasingDirection;
}

export interface AnimationLayer {
  id: string;
  renderVisible: boolean;   // included in export (camera)
  viewportVisible: boolean; // visible in editor (eye)
  keyframes: Keyframe[]; // Sorted by frame
}

export interface EditingState {
  layerId: string;
  frame: number;
  filePath: string;     // Path to the working SVG in .cache/edit/
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

export interface ProjectState {
  // Project metadata
  projectPath: string | null;
  dirty: boolean;

  // Project settings
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  background: BackgroundSettings;

  // Timeline
  layers: AnimationLayer[];
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

  // Inkscape editing state
  editingKeyframe: EditingState | null;

  // Undo/redo
  undoStack: AnimationLayer[][];
  redoStack: AnimationLayer[][];
  canUndo: boolean;
  canRedo: boolean;

  // ── Project lifecycle ─────────────────────────────────

  newProject: (params: {
    projectDir: string;
    width: number;
    height: number;
    fps: number;
    totalFrames: number;
  }) => Promise<void>;

  openProject: (projectDir: string) => Promise<void>;
  saveProject: () => Promise<void>;

  // ── Layer actions ─────────────────────────────────────

  addLayer: () => Promise<void>;
  removeLayer: (id: string) => void;
  moveLayer: (fromIdx: number, toIdx: number) => void;
  toggleRenderVisible: (id: string) => void;
  toggleViewportVisible: (id: string) => void;
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

  startEditing: (layerId: string, frame: number) => Promise<void>;
  stopEditing: () => Promise<void>;
  handleEditingFileChanged: () => Promise<void>;

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

  // ── Undo/Redo ─────────────────────────────────────────

  undo: () => void;
  redo: () => void;

  // ── Playback ────────────────────────────────────────

  playing: boolean;
  play: () => void;
  stop: () => void;

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

/** Format frame number as kf_NNN */
function frameToFilename(frame: number): string {
  return `kf_${String(frame).padStart(3, '0')}.svg`;
}

/** Create a blank SVG with the given dimensions */
function blankSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"></svg>`;
}

/** Build project.json content */
function buildProjectJson(state: {
  fps: number;
  totalFrames: number;
  width: number;
  height: number;
  layers: AnimationLayer[];
  background: BackgroundSettings;
}): string {
  return JSON.stringify({
    fps: String(state.fps),
    frames: String(state.totalFrames),
    width: String(state.width),
    height: String(state.height),
    background: state.background,
    layers: state.layers.map((l) => ({
      id: l.id,
      renderVisible: l.renderVisible,
      viewportVisible: l.viewportVisible,
      keyframes: l.keyframes.map((kf) => ({
        frame: kf.frame,
        tween: kf.tween,
        easing: kf.easing,
      })),
    })),
  }, null, 2);
}

/** Extract inner content from an SVG string (everything inside the root <svg> tag) */
function extractSvgInnerContent(svgString: string): string {
  const match = svgString.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  return match ? match[1].trim() : '';
}

// ── Store ─────────────────────────────────────────────────

export const useProjectStore = create<ProjectState>((set, get) => {

  /** Snapshot current layers onto the undo stack, clear redo */
  function pushUndo() {
    const { layers, undoStack } = get();
    const newStack = [...undoStack, layers].slice(-MAX_UNDO);
    set({ undoStack: newStack, redoStack: [], canUndo: true, canRedo: false, dirty: true });
  }

  return {
  projectPath: null,
  dirty: false,

  width: 1920,
  height: 1080,
  fps: 24,
  totalFrames: 60,
  background: { type: 'none', color: '#ffffff', imageData: '' },

  layers: [],
  selectedLayerId: null,
  currentFrame: 0,

  selection: null,
  clipboard: null,

  canvasZoom: 1,
  canvasPanX: 0,
  canvasPanY: 0,
  canvasContainerWidth: 0,
  canvasContainerHeight: 0,

  compositedSvg: '',
  editingKeyframe: null,

  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,

  playing: false,

  // ── Undo / Redo ─────────────────────────────────────────

  undo: () => {
    const { undoStack, layers } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const newUndoStack = undoStack.slice(0, -1);
    set((s) => ({
      layers: prev,
      undoStack: newUndoStack,
      redoStack: [...s.redoStack, layers],
      canUndo: newUndoStack.length > 0,
      canRedo: true,
      dirty: true,
    }));
    get().recomposite();
  },

  redo: () => {
    const { redoStack, layers } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const newRedoStack = redoStack.slice(0, -1);
    set((s) => ({
      layers: next,
      undoStack: [...s.undoStack, layers],
      redoStack: newRedoStack,
      canUndo: true,
      canRedo: newRedoStack.length > 0,
      dirty: true,
    }));
    get().recomposite();
  },

  // ── Project lifecycle ───────────────────────────────────

  newProject: async ({ projectDir, width, height, fps, totalFrames }) => {
    const api = window.api;

    await api.mkdir(projectDir);
    await api.mkdir(await api.pathJoin(projectDir, 'layers'));
    await api.mkdir(await api.pathJoin(projectDir, '.cache'));

    const initialLayer: AnimationLayer = {
      id: 'layer-1',
      renderVisible: true,
      viewportVisible: true,
      keyframes: [],
    };

    await api.mkdir(await api.pathJoin(projectDir, 'layers', initialLayer.id));

    set({
      projectPath: projectDir,
      dirty: false,
      width,
      height,
      fps,
      totalFrames,
      background: { type: 'none', color: '#ffffff', imageData: '' },
      layers: [initialLayer],
      selectedLayerId: initialLayer.id,
      currentFrame: 0,
      compositedSvg: '',
      editingKeyframe: null,
      selection: null,
      clipboard: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    });

    const state = get();
    await api.writeFile(
      await api.pathJoin(projectDir, 'project.json'),
      buildProjectJson(state)
    );
  },

  openProject: async (projectDir: string) => {
    const api = window.api;

    const jsonPath = await api.pathJoin(projectDir, 'project.json');
    const raw = await api.readFile(jsonPath);
    const proj = JSON.parse(raw);

    const width = Number(proj.width);
    const height = Number(proj.height);

    // Read background settings (backward-compatible default)
    const background: BackgroundSettings = proj.background
      ? { type: proj.background.type || 'none', color: proj.background.color || '#ffffff', imageData: proj.background.imageData || '' }
      : { type: 'none', color: '#ffffff', imageData: '' };

    // Build lookup for keyframe metadata from project.json
    const kfMetaMap = new Map<string, Map<number, { tween: TweenType; easing: EasingDirection }>>();
    for (const layerDef of proj.layers) {
      const frameMeta = new Map<number, { tween: TweenType; easing: EasingDirection }>();
      if (Array.isArray(layerDef.keyframes)) {
        for (const km of layerDef.keyframes) {
          frameMeta.set(km.frame, {
            tween: km.tween || 'linear',
            easing: km.easing || 'in-out',
          });
        }
      }
      kfMetaMap.set(layerDef.id, frameMeta);
    }

    const layers: AnimationLayer[] = [];
    for (const layerDef of proj.layers) {
      const layerDir = await api.pathJoin(projectDir, 'layers', layerDef.id);
      const files = await api.readdir(layerDir);
      const meta = kfMetaMap.get(layerDef.id);

      const keyframes: Keyframe[] = [];
      for (const file of files.sort()) {
        if (!file.startsWith('kf_') || !file.endsWith('.svg')) continue;
        const frameNum = parseInt(file.replace('kf_', '').replace('.svg', ''), 10);
        const svgContent = await api.readFile(await api.pathJoin(layerDir, file));
        const m = meta?.get(frameNum);
        keyframes.push({
          frame: frameNum,
          svgContent,
          tween: m?.tween ?? 'linear',
          easing: m?.easing ?? 'in-out',
        });
      }

      layers.push({
        id: layerDef.id,
        renderVisible: layerDef.renderVisible !== false,
        viewportVisible: layerDef.viewportVisible !== false,
        keyframes,
      });
    }

    set({
      projectPath: projectDir,
      dirty: false,
      width,
      height,
      fps: Number(proj.fps),
      totalFrames: Number(proj.frames),
      background,
      layers,
      selectedLayerId: layers.length > 0 ? layers[0].id : null,
      currentFrame: 0,
      compositedSvg: '',
      editingKeyframe: null,
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
    const state = get();
    if (!state.projectPath) return;
    const api = window.api;

    await api.writeFile(
      await api.pathJoin(state.projectPath, 'project.json'),
      buildProjectJson(state)
    );

    const layersDir = await api.pathJoin(state.projectPath, 'layers');
    const layerIdsOnDisk = await api.exists(layersDir) ? await api.readdir(layersDir) : [];
    const activeLayerIds = new Set(state.layers.map((l) => l.id));

    // Remove layer directories that no longer exist in state
    for (const dirName of layerIdsOnDisk) {
      if (!activeLayerIds.has(dirName)) {
        await api.rmdir(await api.pathJoin(layersDir, dirName));
      }
    }

    // Write active layers and clean up stale keyframe files
    for (const layer of state.layers) {
      const layerDir = await api.pathJoin(layersDir, layer.id);
      await api.mkdir(layerDir);

      const activeFiles = new Set(layer.keyframes.map((kf) => frameToFilename(kf.frame)));
      const filesOnDisk = await api.readdir(layerDir);

      // Remove keyframe files that no longer exist in state
      for (const file of filesOnDisk) {
        if (file.endsWith('.svg') && !activeFiles.has(file)) {
          await api.rm(await api.pathJoin(layerDir, file));
        }
      }

      // Write current keyframes
      for (const kf of layer.keyframes) {
        await api.writeFile(
          await api.pathJoin(layerDir, frameToFilename(kf.frame)),
          kf.svgContent
        );
      }
    }

    set({ dirty: false });
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
      renderVisible: true,
      viewportVisible: true,
      keyframes: [],
    };

    if (state.projectPath) {
      const api = window.api;
      await api.mkdir(await api.pathJoin(state.projectPath, 'layers', id));
    }

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
      const inner = renderLayer(layer, frame);
      if (inner) {
        svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${inner}\n</svg>`;
      } else {
        svgContent = blankSvg(state.width, state.height);
      }
    } else {
      svgContent = blankSvg(state.width, state.height);
    }

    if (state.projectPath) {
      const api = window.api;
      const filePath = await api.pathJoin(
        state.projectPath, 'layers', layerId, frameToFilename(frame)
      );
      await api.writeFile(filePath, svgContent);
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
    const { selection, clipboard, layers, totalFrames } = get();
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

  // ── Inkscape editing ────────────────────────────────────

  startEditing: async (layerId: string, frame: number) => {
    const state = get();
    if (!state.projectPath) return;
    const api = window.api;

    const layer = state.layers.find((l) => l.id === layerId);
    if (!layer) return;

    const kf = layer.keyframes.find((k) => k.frame === frame);
    if (!kf) return;

    // Stop playback before editing
    if (state.playing) get().stop();

    if (state.editingKeyframe) {
      await get().stopEditing();
    }

    const editDir = await api.pathJoin(state.projectPath, '.cache', 'edit');
    await api.mkdir(editDir);

    const contextRefs: { id: string; filePath: string }[] = [];
    for (const otherLayer of state.layers) {
      if (otherLayer.id === layerId || !otherLayer.viewportVisible) continue;

      const nearestKf = findNearestKeyframe(otherLayer.keyframes, frame);
      if (!nearestKf) continue;

      const ctxPath = await api.pathJoin(editDir, `context_${otherLayer.id}.svg`);
      await api.writeFile(ctxPath, nearestKf.svgContent);
      contextRefs.push({ id: otherLayer.id, filePath: ctxPath });
    }

    const editableContent = extractSvgInnerContent(kf.svgContent);

    let contextLayers = '';

    // Background context layer (bottommost)
    if (state.background.type === 'solid') {
      contextLayers += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] background" sodipodi:insensitive="true">\n`;
      contextLayers += `    <rect width="${state.width}" height="${state.height}" fill="${state.background.color}" />\n`;
      contextLayers += `  </g>\n`;
    } else if (state.background.type === 'image' && state.background.imageData) {
      contextLayers += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] background" sodipodi:insensitive="true">\n`;
      contextLayers += `    <image href="${state.background.imageData}" width="${state.width}" height="${state.height}" />\n`;
      contextLayers += `  </g>\n`;
    }

    for (const ctx of contextRefs) {
      const fileUri = ctx.filePath.replace(/\\/g, '/');
      contextLayers += `  <g inkscape:groupmode="layer" inkscape:label="[ctx] ${ctx.id}" sodipodi:insensitive="true">\n`;
      contextLayers += `    <image href="file:///${fileUri}" width="${state.width}" height="${state.height}" />\n`;
      contextLayers += `  </g>\n`;
    }

    const workingSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
     width="${state.width}" height="${state.height}"
     viewBox="0 0 ${state.width} ${state.height}">
${contextLayers}  <g inkscape:groupmode="layer" inkscape:label="${layer.id}">
${editableContent ? '    ' + editableContent + '\n' : ''}  </g>
</svg>`;

    const frameStr = String(frame).padStart(3, '0');
    const workingPath = await api.pathJoin(editDir, `editing_${layerId}_kf${frameStr}.svg`);
    await api.writeFile(workingPath, workingSvg);

    await api.watchFile(workingPath);

    const cleanup = api.onFileChanged((changedPath: string) => {
      if (changedPath === workingPath) {
        get().handleEditingFileChanged();
      }
    });

    set({
      editingKeyframe: {
        layerId,
        frame,
        filePath: workingPath,
      },
    });

    (get() as any)._editCleanup = cleanup;

    const exitCleanup = api.onInkscapeExited(() => {
      get().stopEditing();
    });
    (get() as any)._exitCleanup = exitCleanup;

    try {
      await api.spawnInkscape(workingPath);
    } catch {
      await get().stopEditing();
    }
  },

  stopEditing: async () => {
    const state = get();
    if (!state.editingKeyframe) return;

    const api = window.api;
    await api.unwatchFile(state.editingKeyframe.filePath);

    const cleanup = (state as any)._editCleanup;
    if (cleanup) cleanup();

    const exitCleanup = (state as any)._exitCleanup;
    if (exitCleanup) exitCleanup();

    set({ editingKeyframe: null });
  },

  handleEditingFileChanged: async () => {
    const state = get();
    if (!state.editingKeyframe || !state.projectPath) return;

    const api = window.api;
    const { layerId, frame, filePath } = state.editingKeyframe;

    const workingSvg = await api.readFile(filePath);

    let cleaned = workingSvg;
    cleaned = cleaned.replace(
      /<g[^>]*inkscape:label="\[ctx\][^"]*"[^>]*>[\s\S]*?<\/g>/g,
      ''
    );

    // Preserve root-level <defs> (gradients, filters, clip-paths, etc.)
    const defsBlocks: string[] = [];
    cleaned.replace(/<defs[\s>][\s\S]*?<\/defs>/gi, (match) => {
      defsBlocks.push(match);
      return '';
    });
    const defsContent = defsBlocks.length > 0 ? defsBlocks.join('\n') + '\n' : '';

    const layerMatch = cleaned.match(
      /<g[^>]*inkscape:groupmode="layer"[^>]*>([\s\S]*?)<\/g>/
    );

    const innerContent = layerMatch ? layerMatch[1].trim() : extractSvgInnerContent(cleaned);

    const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${state.width}" height="${state.height}" viewBox="0 0 ${state.width} ${state.height}">\n${defsContent}${innerContent}\n</svg>`;

    const kfPath = await api.pathJoin(
      state.projectPath, 'layers', layerId, frameToFilename(frame)
    );
    await api.writeFile(kfPath, cleanSvg);

    pushUndo();

    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l;
        return {
          ...l,
          keyframes: l.keyframes.map((kf) =>
            kf.frame === frame ? { ...kf, svgContent: cleanSvg } : kf
          ),
        };
      }),
    }));

    get().recomposite();
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

  // ── Playback ────────────────────────────────────────────

  play: () => {
    const { editingKeyframe, playing } = get();
    if (editingKeyframe || playing) return;
    set({ playing: true });

    let lastTime = performance.now();
    const tick = (now: number) => {
      const state = get();
      if (!state.playing) return;
      const elapsed = now - lastTime;
      const frameDuration = 1000 / state.fps;
      if (elapsed >= frameDuration) {
        lastTime = now - (elapsed % frameDuration);
        const nextFrame = (state.currentFrame + 1) % state.totalFrames;
        set({ currentFrame: nextFrame });
        state.recomposite();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  stop: () => {
    set({ playing: false });
  },

  // ── Compositor ──────────────────────────────────────────

  recomposite: () => {
    const { layers, currentFrame, width, height } = get();
    const combined = compositeFrame(layers, currentFrame, width, height);
    set({ compositedSvg: combined });
  },
};
});
