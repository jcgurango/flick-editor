import { create } from 'zustand'
import { createProject, createLayer, generateId } from './types/project'
import type { Project, Layer, Keyframe, TweenType, EaseDirection, FlickObject, FrameSelection, Clipboard, FrameClipboardLayer, FrameClipboardEntry } from './types/project'
import { recenterPath } from './lib/transform'
import { resolveFrame } from './lib/interpolate'

const MAX_UNDO = 100

interface EditorState {
  // Project
  project: Project
  setProject: (project: Project) => void
  resetProject: (project: Project) => void
  documentName: string
  setDocumentName: (name: string) => void

  // Undo/Redo
  _undoStack: Project[]
  _redoStack: Project[]
  undo: () => void
  redo: () => void

  // Clipboard
  clipboard: Clipboard
  copySelectedObjects: () => void
  pasteObjects: () => void
  copyFrames: () => void
  pasteFrames: () => void
  copyLayers: () => void
  pasteLayers: () => void

  // Playback
  currentFrame: number
  setCurrentFrame: (frame: number) => void
  isPlaying: boolean
  togglePlayback: () => void
  _playRafId: number | null

  // Tools
  activeTool: string
  setActiveTool: (tool: string) => void

  // Selection
  activeLayerId: string
  setActiveLayerId: (id: string) => void
  selectedLayerIds: string[]
  setSelectedLayerIds: (ids: string[]) => void
  toggleSelectedLayerId: (id: string) => void
  frameSelection: FrameSelection | null
  setFrameSelection: (sel: FrameSelection | null) => void
  selectedObjectIds: string[]
  setSelectedObjectIds: (ids: string[]) => void
  toggleSelectedObjectId: (id: string) => void
  inspectorFocus: 'canvas' | 'timeline' | 'layer'
  setInspectorFocus: (focus: 'canvas' | 'timeline' | 'layer') => void

  // Viewport
  zoom: number
  setZoom: (zoom: number) => void
  pan: { x: number; y: number }
  setPan: (pan: { x: number; y: number }) => void
  containerSize: { width: number; height: number }
  setContainerSize: (size: { width: number; height: number }) => void
  recenterView: () => void
  setView100: () => void

  // Actions
  setKeyframeTween: (layerId: string, frame: number, tween: TweenType) => void
  setKeyframeEaseDirection: (layerId: string, frame: number, easeDirection: EaseDirection) => void
  updateObjectAttrs: (layerId: string, frame: number, objectId: string, attrs: Record<string, unknown>) => void
  addObjectToKeyframe: (layerId: string, frame: number, object: FlickObject) => void
  setFrameRate: (fps: number) => void
  setProjectDimensions: (width: number, height: number) => void
  setTotalFrames: (totalFrames: number) => void
  renameLayer: (layerId: string, name: string) => void
  toggleLayerVisibility: (layerId: string) => void
  toggleLayerLocked: (layerId: string) => void
  setAllLayersVisible: (visible: boolean) => void
  setAllLayersLocked: (locked: boolean) => void
  insertKeyframe: (layerId: string, frame: number) => void
  insertBlankKeyframe: (layerId: string, frame: number) => void
  reorderObject: (layerId: string, objectId: string, newIndex: number) => void
  moveObjectToLayer: (objectId: string, fromLayerId: string, toLayerId: string, insertIndex: number) => void
  addLayer: () => void
  reorderLayer: (layerId: string, newIndex: number) => void
  reorderLayers: (layerIds: string[], newIndex: number) => void
  setKeyframeLoop: (layerId: string, frame: number, loop: boolean) => void
  moveKeyframe: (layerId: string, fromFrame: number, toFrame: number) => void
  deleteSelectedObjects: () => void
  deleteKeyframe: (layerId: string, frame: number) => void
  deleteFrameSelection: () => void
  deleteLayer: (layerId: string) => void
  deleteSelectedLayers: () => void
}

function createDemoProject(): Project {
  const p = createProject()
  const rectId = generateId()
  const rectId2 = generateId()

  p.layers[0].keyframes = [
    {
      frame: 1,
      tween: 'smooth',
      easeDirection: 'in-out',
      objects: [
        {
          id: rectId,
          type: 'rect',
          attrs: { x: 200, y: 200, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 15, rx: 20, rotation: 0 },
        },
        {
          id: rectId2,
          type: 'rect',
          attrs: { x: 200, y: 400, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rx: 4, rotation: 0 },
        },
      ],
    },
    {
      frame: 15,
      tween: 'discrete',
      easeDirection: 'in-out',
      objects: [
        {
          id: rectId,
          type: 'rect',
          attrs: { x: 800, y: 400, width: 400, height: 250, fill: '#ff6a4a', stroke: '#cc3322', strokeWidth: 2, rx: 4, rotation: 45 },
        },
        {
          id: rectId2,
          type: 'rect',
          attrs: { x: 200, y: 500, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rx: 4, rotation: 0 },
        },
      ],
    },
  ]

  const splatLayer = createLayer('Splat')
  const splatId = generateId()
  const s1 = recenterPath('M600,700 C620,660 670,650 700,670 C730,650 780,660 800,700 C820,740 810,790 780,810 C800,830 790,870 760,880 C740,900 700,910 680,890 C660,910 620,900 600,880 C580,860 570,830 590,810 C560,790 550,740 600,700 Z')
  const s2 = recenterPath('M580,680 C610,630 690,620 730,660 C770,630 820,670 810,720 C840,750 830,810 790,830 C810,860 780,900 740,900 C720,930 670,930 650,900 C620,920 580,890 580,860 C550,840 540,780 570,760 C540,730 550,690 580,680 Z')
  splatLayer.keyframes = [
    {
      frame: 1,
      tween: 'smooth',
      easeDirection: 'in-out',
      objects: [
        {
          id: splatId,
          type: 'path',
          attrs: { d: s1.d, x: s1.x, y: s1.y, fill: '#e8443a', stroke: '#a02020', strokeWidth: 3, rotation: 0 },
        },
      ],
    },
    {
      frame: 15,
      tween: 'discrete',
      easeDirection: 'in-out',
      objects: [
        {
          id: splatId,
          type: 'path',
          attrs: { d: s2.d, x: s2.x, y: s2.y, fill: '#44cc88', stroke: '#228855', strokeWidth: 3, rotation: 0 },
        },
      ],
    },
  ]
  p.layers.push(splatLayer)

  const layer2 = createLayer('Layer 2')
  const circleId = generateId()
  layer2.keyframes = [
    {
      frame: 1,
      tween: 'discrete',
      easeDirection: 'in-out',
      objects: [
        {
          id: circleId,
          type: 'ellipse',
          attrs: { cx: 1400, cy: 300, rx: 80, ry: 80, fill: '#44cc88', stroke: '#228855', strokeWidth: 2, rotation: 0 },
        },
      ],
    },
  ]
  p.layers.push(layer2)
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))

  return p
}

const initialProject = createDemoProject()

/** Push current project onto undo stack, clear redo. */
function pushUndo(state: EditorState): Partial<EditorState> {
  const stack = state._undoStack.length >= MAX_UNDO
    ? state._undoStack.slice(1)
    : state._undoStack
  return { _undoStack: [...stack, state.project], _redoStack: [] }
}

export const useStore = create<EditorState>((set) => ({
  project: initialProject,
  setProject: (project) => set({ project }),
  resetProject: (project) => set({
    project,
    _undoStack: [],
    _redoStack: [],
    currentFrame: 1,
    activeLayerId: project.layers[0]?.id ?? '',
    selectedLayerIds: project.layers[0] ? [project.layers[0].id] : [],
    frameSelection: null,
    selectedObjectIds: [],
    clipboard: { type: 'objects', layerId: '', objects: [] },
    inspectorFocus: 'canvas' as const,
    isPlaying: false,
  }),
  documentName: '',
  setDocumentName: (documentName) => set({ documentName }),

  // Undo/Redo
  _undoStack: [],
  _redoStack: [],
  undo: () =>
    set((state) => {
      if (state._undoStack.length === 0) return state
      const prev = state._undoStack[state._undoStack.length - 1]
      return {
        _undoStack: state._undoStack.slice(0, -1),
        _redoStack: [...state._redoStack, state.project],
        project: prev,
      }
    }),
  redo: () =>
    set((state) => {
      if (state._redoStack.length === 0) return state
      const next = state._redoStack[state._redoStack.length - 1]
      return {
        _redoStack: state._redoStack.slice(0, -1),
        _undoStack: [...state._undoStack, state.project],
        project: next,
      }
    }),

  // Clipboard
  clipboard: { type: 'objects', layerId: '', objects: [] },
  copySelectedObjects: () => {
    const s = useStore.getState()
    const layer = s.project.layers.find((l) => l.id === s.activeLayerId)
    const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
    if (!layer || !kf) return
    const objs = kf.objects.filter((o) => s.selectedObjectIds.includes(o.id))
    if (objs.length === 0) return
    set({ clipboard: { type: 'objects', layerId: layer.id, objects: JSON.parse(JSON.stringify(objs)) } })
  },
  pasteObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.type !== 'objects' || s.clipboard.objects.length === 0) return
    const layer = s.project.layers.find((l: Layer) => l.id === s.activeLayerId)
    if (!layer) return

    // Auto-create keyframe if none exists at current frame (like F6)
    let project = s.project
    let kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) {
      const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(layer, s.currentFrame)))
      kf = { frame: s.currentFrame, objects, tween: 'discrete', easeDirection: 'in-out' }
      project = {
        ...project,
        layers: project.layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: [...l.keyframes, kf!].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
          },
        ),
      }
    }

    const sameLayer = s.clipboard.layerId === layer.id
    const existingIds = new Set(kf.objects.map((o: FlickObject) => o.id))
    const pasted: FlickObject[] = s.clipboard.objects.map((obj: FlickObject) => {
      const clone: FlickObject = JSON.parse(JSON.stringify(obj))
      if (!sameLayer || existingIds.has(clone.id)) {
        clone.id = generateId()
      }
      return clone
    })

    const newProject: Project = {
      ...project,
      layers: project.layers.map((l: Layer) =>
        l.id !== layer.id ? l : {
          ...l,
          keyframes: l.keyframes.map((k: Keyframe) =>
            k.frame !== s.currentFrame ? k : { ...k, objects: [...k.objects, ...pasted] },
          ),
        },
      ),
    }
    set({
      ...pushUndo(s),
      project: newProject,
      selectedObjectIds: pasted.map((o: FlickObject) => o.id),
    })
  },
  copyFrames: () => {
    const s = useStore.getState()
    if (!s.frameSelection) return
    const { layerIds, startFrame, endFrame } = s.frameSelection
    const frameCount = endFrame - startFrame + 1
    const clipLayers: FrameClipboardLayer[] = []

    for (const layerId of layerIds) {
      const layer = s.project.layers.find((l: Layer) => l.id === layerId)
      if (!layer) { clipLayers.push({ frames: {} }); continue }
      const frames: Record<number, FrameClipboardEntry> = {}
      for (let f = startFrame; f <= endFrame; f++) {
        const offset = f - startFrame
        const kf = layer.keyframes.find((k: Keyframe) => k.frame === f)
        if (kf) {
          frames[offset] = {
            objects: JSON.parse(JSON.stringify(kf.objects)),
            tween: kf.tween,
            easeDirection: kf.easeDirection,
            ...(kf.loop ? { loop: true } : {}),
          }
        } else if (offset === 0) {
          // First frame of range: resolve interpolated state
          const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(layer, f)))
          frames[offset] = { objects, tween: 'discrete', easeDirection: 'in-out' }
        }
      }
      clipLayers.push({ frames })
    }

    set({ clipboard: { type: 'frames', grid: { layers: clipLayers, frameCount } } })
  },
  pasteFrames: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.type !== 'frames') return
    const { grid } = s.clipboard
    const activeIdx = s.project.layers.findIndex((l: Layer) => l.id === s.activeLayerId)
    if (activeIdx === -1) return

    let project: Project = JSON.parse(JSON.stringify(s.project))

    for (let li = 0; li < grid.layers.length; li++) {
      const destIdx = activeIdx + li
      if (destIdx >= project.layers.length) break
      const destLayer = project.layers[destIdx]
      const clipLayer = grid.layers[li]

      for (let offset = 0; offset < grid.frameCount; offset++) {
        const targetFrame = s.currentFrame + offset
        if (targetFrame > project.totalFrames) break
        const clipEntry = clipLayer.frames[offset]
        if (!clipEntry) continue

        // Ensure a keyframe exists at target frame
        let kf = destLayer.keyframes.find((k: Keyframe) => k.frame === targetFrame)
        if (!kf) {
          const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(destLayer, targetFrame)))
          kf = { frame: targetFrame, objects, tween: 'discrete', easeDirection: 'in-out' }
          destLayer.keyframes.push(kf)
          destLayer.keyframes.sort((a: Keyframe, b: Keyframe) => a.frame - b.frame)
        }

        // Overwrite tween settings
        kf.tween = clipEntry.tween
        kf.easeDirection = clipEntry.easeDirection
        kf.loop = clipEntry.loop

        // Replace existing objects by ID, append only if no match exists
        for (const obj of clipEntry.objects) {
          const clone: FlickObject = JSON.parse(JSON.stringify(obj))
          const existingIdx = kf.objects.findIndex((o: FlickObject) => o.id === clone.id)
          if (existingIdx !== -1) {
            // Replace in-place
            kf.objects[existingIdx] = clone
          } else {
            // Append new object
            kf.objects.push(clone)
          }
        }
      }
    }

    set({
      ...pushUndo(s),
      project,
    })
  },
  copyLayers: () => {
    const s = useStore.getState()
    if (s.selectedLayerIds.length === 0) return
    const layerSet = new Set(s.selectedLayerIds)
    const layers = s.project.layers.filter((l: Layer) => layerSet.has(l.id))
    set({ clipboard: { type: 'layers', layers: JSON.parse(JSON.stringify(layers)) } })
  },
  pasteLayers: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.type !== 'layers') return
    const activeIdx = s.project.layers.findIndex((l: Layer) => l.id === s.activeLayerId)
    if (activeIdx === -1) return
    // Deep clone and regenerate all IDs
    const newLayers: Layer[] = s.clipboard.layers.map((layer: Layer) => {
      const idRemap = new Map<string, string>()
      const newLayer: Layer = JSON.parse(JSON.stringify(layer))
      newLayer.id = generateId()
      newLayer.name = layer.name + ' copy'
      for (const kf of newLayer.keyframes) {
        for (const obj of kf.objects) {
          if (!idRemap.has(obj.id)) idRemap.set(obj.id, generateId())
          obj.id = idRemap.get(obj.id)!
        }
      }
      return newLayer
    })
    const layers = [...s.project.layers]
    layers.splice(activeIdx + 1, 0, ...newLayers)
    set({
      ...pushUndo(s),
      project: { ...s.project, layers },
      activeLayerId: newLayers[0].id,
      selectedLayerIds: newLayers.map((l: Layer) => l.id),
    })
  },

  currentFrame: 1,
  setCurrentFrame: (currentFrame) => set({ currentFrame }),
  isPlaying: false,
  _playRafId: null,
  togglePlayback: () => {
    const state = useStore.getState()
    if (state.isPlaying) {
      if (state._playRafId !== null) cancelAnimationFrame(state._playRafId)
      set({ isPlaying: false, _playRafId: null })
    } else {
      const frameDuration = 1000 / state.project.frameRate
      const maxFrame = state.project.totalFrames
      const startTime = Date.now()
      const startFrame = state.currentFrame

      const tick = () => {
        const s = useStore.getState()
        if (!s.isPlaying) return

        const elapsed = Date.now() - startTime
        const framesElapsed = Math.floor(elapsed / frameDuration)
        const frame = ((startFrame - 1 + framesElapsed) % maxFrame) + 1

        if (frame !== s.currentFrame) {
          set({ currentFrame: frame })
        }

        set({ _playRafId: requestAnimationFrame(tick) })
      }

      const rafId = requestAnimationFrame(tick)
      set({ isPlaying: true, _playRafId: rafId })
    }
  },

  activeTool: 'select',
  setActiveTool: (activeTool) => set({ activeTool }),

  activeLayerId: initialProject.layers[0].id,
  setActiveLayerId: (activeLayerId) => set({ activeLayerId }),
  selectedLayerIds: [initialProject.layers[0].id],
  setSelectedLayerIds: (selectedLayerIds) => set({ selectedLayerIds }),
  toggleSelectedLayerId: (id) =>
    set((state) => ({
      selectedLayerIds: state.selectedLayerIds.includes(id)
        ? state.selectedLayerIds.filter((lid) => lid !== id)
        : [...state.selectedLayerIds, id],
    })),
  frameSelection: null,
  setFrameSelection: (frameSelection) => set({ frameSelection }),
  selectedObjectIds: [],
  setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
  toggleSelectedObjectId: (id) =>
    set((state) => ({
      selectedObjectIds: state.selectedObjectIds.includes(id)
        ? state.selectedObjectIds.filter((oid) => oid !== id)
        : [...state.selectedObjectIds, id],
    })),
  inspectorFocus: 'canvas' as const,
  setInspectorFocus: (inspectorFocus) => set({ inspectorFocus }),

  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  pan: { x: 0, y: 0 },
  setPan: (pan) => set({ pan }),
  containerSize: { width: 0, height: 0 },
  setContainerSize: (containerSize) => set({ containerSize }),
  recenterView: () => {
    const s = useStore.getState()
    const { width: cw, height: ch } = s.containerSize
    if (cw === 0 || ch === 0) return
    const padding = 40
    const scaleX = (cw - padding * 2) / s.project.width
    const scaleY = (ch - padding * 2) / s.project.height
    const fitZoom = Math.min(scaleX, scaleY)
    set({
      zoom: fitZoom,
      pan: {
        x: (cw - s.project.width * fitZoom) / 2,
        y: (ch - s.project.height * fitZoom) / 2,
      },
    })
  },
  setView100: () => {
    const s = useStore.getState()
    const { width: cw, height: ch } = s.containerSize
    set({
      zoom: 1,
      pan: {
        x: (cw - s.project.width) / 2,
        y: (ch - s.project.height) / 2,
      },
    })
  },

  setKeyframeTween: (layerId, frame, tween) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId
            ? layer
            : {
                ...layer,
                keyframes: layer.keyframes.map((kf) =>
                  kf.frame !== frame ? kf : { ...kf, tween },
                ),
              },
        ),
      },
    })),

  setKeyframeEaseDirection: (layerId, frame, easeDirection) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId
            ? layer
            : {
                ...layer,
                keyframes: layer.keyframes.map((kf) =>
                  kf.frame !== frame ? kf : { ...kf, easeDirection },
                ),
              },
        ),
      },
    })),

  updateObjectAttrs: (layerId, frame, objectId, attrs) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId
            ? layer
            : {
                ...layer,
                keyframes: layer.keyframes.map((kf) =>
                  kf.frame !== frame
                    ? kf
                    : {
                        ...kf,
                        objects: kf.objects.map((obj) =>
                          obj.id !== objectId
                            ? obj
                            : { ...obj, attrs: { ...obj.attrs, ...attrs } },
                        ),
                      },
                ),
              },
        ),
      },
    })),

  addObjectToKeyframe: (layerId, frame, object) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId
            ? layer
            : {
                ...layer,
                keyframes: layer.keyframes.map((kf) =>
                  kf.frame !== frame
                    ? kf
                    : { ...kf, objects: [...kf.objects, object] },
                ),
              },
        ),
      },
    })),

  setFrameRate: (fps) =>
    set((state) => ({
      ...pushUndo(state),
      project: { ...state.project, frameRate: fps },
    })),

  setProjectDimensions: (width, height) =>
    set((state) => ({
      ...pushUndo(state),
      project: { ...state.project, width, height },
    })),

  setTotalFrames: (totalFrames) =>
    set((state) => ({
      ...pushUndo(state),
      project: { ...state.project, totalFrames },
    })),

  renameLayer: (layerId, name) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId ? layer : { ...layer, name },
        ),
      },
    })),

  toggleLayerVisibility: (layerId) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId ? layer : { ...layer, visible: !layer.visible },
        ),
      },
    })),

  toggleLayerLocked: (layerId) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId ? layer : { ...layer, locked: !layer.locked },
        ),
      },
    })),

  setAllLayersVisible: (visible) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) => ({ ...layer, visible })),
      },
    })),

  setAllLayersLocked: (locked) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) => ({ ...layer, locked })),
      },
    })),

  insertKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = state.project.layers.find((l: Layer) => l.id === layerId)
      if (!layer) return state
      // Don't insert if a keyframe already exists at this frame
      if (layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      // Resolve the interpolated objects at this frame
      const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(layer, frame)))
      const newKf: Keyframe = { frame, objects, tween: 'discrete', easeDirection: 'in-out' }
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: [...l.keyframes, newKf].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
            },
          ),
        },
      }
    }),

  insertBlankKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = state.project.layers.find((l: Layer) => l.id === layerId)
      if (!layer) return state
      if (layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      const newKf: Keyframe = { frame, objects: [], tween: 'discrete', easeDirection: 'in-out' }
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: [...l.keyframes, newKf].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
            },
          ),
        },
      }
    }),

  reorderObject: (layerId, objectId, newIndex) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((l: Layer) =>
          l.id !== layerId ? l : {
            ...l,
            keyframes: l.keyframes.map((kf: Keyframe) => {
              const idx = kf.objects.findIndex((o: FlickObject) => o.id === objectId)
              if (idx === -1) return kf
              const objs = [...kf.objects]
              const [obj] = objs.splice(idx, 1)
              const insertAt = Math.min(newIndex, objs.length)
              objs.splice(insertAt, 0, obj)
              return { ...kf, objects: objs }
            }),
          },
        ),
      },
    })),

  moveObjectToLayer: (objectId, fromLayerId, toLayerId, insertIndex) =>
    set((state) => {
      if (fromLayerId === toLayerId) return state
      const fromLayer = state.project.layers.find((l: Layer) => l.id === fromLayerId)
      if (!fromLayer) return state

      // Collect object versions from each keyframe on source layer
      const objByFrame = new Map<number, FlickObject>()
      for (const kf of fromLayer.keyframes) {
        const obj = kf.objects.find((o: FlickObject) => o.id === objectId)
        if (obj) objByFrame.set(kf.frame, obj)
      }
      if (objByFrame.size === 0) return state

      // Fallback object for frames where source didn't have this object
      const fallbackObj = objByFrame.values().next().value!

      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) => {
            if (l.id === fromLayerId) {
              return {
                ...l,
                keyframes: l.keyframes.map((kf: Keyframe) => ({
                  ...kf,
                  objects: kf.objects.filter((o: FlickObject) => o.id !== objectId),
                })),
              }
            }
            if (l.id === toLayerId) {
              return {
                ...l,
                keyframes: l.keyframes.map((kf: Keyframe) => {
                  const obj = objByFrame.get(kf.frame) ?? fallbackObj
                  const objs = [...kf.objects]
                  objs.splice(Math.min(insertIndex, objs.length), 0, obj)
                  return { ...kf, objects: objs }
                }),
              }
            }
            return l
          }),
        },
      }
    }),

  addLayer: () =>
    set((state) => {
      const activeIdx = state.project.layers.findIndex((l: Layer) => l.id === state.activeLayerId)
      const insertAt = activeIdx === -1 ? state.project.layers.length : activeIdx + 1
      // Generate unique name
      const existingNames = new Set(state.project.layers.map((l: Layer) => l.name))
      let name = 'Layer'
      let n = 1
      while (existingNames.has(name)) { n++; name = `Layer ${n}` }
      const newLayer = createLayer(name)
      const layers = [...state.project.layers]
      layers.splice(insertAt, 0, newLayer)
      return {
        ...pushUndo(state),
        project: { ...state.project, layers },
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
      }
    }),

  reorderLayer: (layerId, newIndex) =>
    set((state) => {
      const idx = state.project.layers.findIndex((l: Layer) => l.id === layerId)
      if (idx === -1 || idx === newIndex) return state
      const layers = [...state.project.layers]
      const [layer] = layers.splice(idx, 1)
      // Adjust: removing source shifts indices above it down by 1
      const adjustedIndex = idx < newIndex ? newIndex - 1 : newIndex
      const insertAt = Math.min(adjustedIndex, layers.length)
      layers.splice(insertAt, 0, layer)
      return {
        ...pushUndo(state),
        project: { ...state.project, layers },
      }
    }),

  reorderLayers: (layerIds, newIndex) =>
    set((state) => {
      const idSet = new Set(layerIds)
      // Count how many selected layers sit above the target index
      const aboveCount = state.project.layers.filter(
        (l: Layer, i: number) => idSet.has(l.id) && i < newIndex,
      ).length
      const remaining = state.project.layers.filter((l: Layer) => !idSet.has(l.id))
      // Preserve order of selected layers as they appear in the project
      const moving = state.project.layers.filter((l: Layer) => idSet.has(l.id))
      const insertAt = Math.min(newIndex - aboveCount, remaining.length)
      const layers = [...remaining]
      layers.splice(insertAt, 0, ...moving)
      return {
        ...pushUndo(state),
        project: { ...state.project, layers },
      }
    }),

  setKeyframeLoop: (layerId, frame, loop) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        layers: state.project.layers.map((layer) =>
          layer.id !== layerId
            ? layer
            : {
                ...layer,
                keyframes: layer.keyframes.map((kf) =>
                  kf.frame !== frame ? kf : { ...kf, loop },
                ),
              },
        ),
      },
    })),

  moveKeyframe: (layerId, fromFrame, toFrame) =>
    set((state) => {
      if (fromFrame === toFrame) return state
      const layer = state.project.layers.find((l: Layer) => l.id === layerId)
      if (!layer) return state
      const kfIdx = layer.keyframes.findIndex((k: Keyframe) => k.frame === fromFrame)
      if (kfIdx === -1) return state
      const existingIdx = layer.keyframes.findIndex((k: Keyframe) => k.frame === toFrame)
      const newKeyframes = [...layer.keyframes]
      // Remove existing keyframe at target if present
      if (existingIdx !== -1) {
        newKeyframes.splice(existingIdx, 1)
      }
      // Update the moved keyframe's frame number (re-find index since splice may have shifted it)
      const movedIdx = newKeyframes.findIndex((k: Keyframe) => k.frame === fromFrame)
      newKeyframes[movedIdx] = { ...newKeyframes[movedIdx], frame: toFrame }
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) =>
            l.id !== layerId ? l : { ...l, keyframes: newKeyframes },
          ),
        },
      }
    }),

  deleteSelectedObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.selectedObjectIds.length === 0) return
    const kfs = s.project
      .layers
      .map(l => l.keyframes.find((k: Keyframe) => k.frame === s.currentFrame))
      .filter(Boolean)

    if (!kfs.length) return
    const idsToDelete = new Set(s.selectedObjectIds)
    const newProject: Project = {
      ...s.project,
      layers: s.project.layers.map((l: Layer) => ({
          ...l,
          keyframes: l.keyframes.map((k: Keyframe) =>
            !kfs.includes(k) ? k : {
              ...k,
              objects: k.objects.filter((o: FlickObject) => !idsToDelete.has(o.id)),
            },
          ),
        }),
      ),
    }
    set({
      ...pushUndo(s),
      project: newProject,
      selectedObjectIds: [],
    })
  },

  deleteKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = state.project.layers.find((l: Layer) => l.id === layerId)
      if (!layer) return state
      if (!layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: l.keyframes.filter((kf: Keyframe) => kf.frame !== frame),
            },
          ),
        },
        frameSelection: null,
      }
    }),

  deleteFrameSelection: () =>
    set((state) => {
      if (!state.frameSelection) return state
      const { layerIds, startFrame, endFrame } = state.frameSelection
      const layerSet = new Set(layerIds)
      return {
        ...pushUndo(state),
        project: {
          ...state.project,
          layers: state.project.layers.map((l: Layer) =>
            !layerSet.has(l.id) ? l : {
              ...l,
              keyframes: l.keyframes.filter((kf: Keyframe) =>
                kf.frame < startFrame || kf.frame > endFrame,
              ),
            },
          ),
        },
        frameSelection: null,
      }
    }),

  deleteLayer: (layerId) =>
    set((state) => {
      if (state.project.layers.length <= 1) return state
      const layers = state.project.layers.filter((l: Layer) => l.id !== layerId)
      const newActiveId = state.activeLayerId === layerId ? layers[0].id : state.activeLayerId
      return {
        ...pushUndo(state),
        project: { ...state.project, layers },
        activeLayerId: newActiveId,
        selectedLayerIds: [newActiveId],
        frameSelection: null,
        selectedObjectIds: [],
      }
    }),

  deleteSelectedLayers: () =>
    set((state) => {
      const idSet = new Set(state.selectedLayerIds)
      const remaining = state.project.layers.filter((l: Layer) => !idSet.has(l.id))
      if (remaining.length === 0) return state // don't delete all layers
      const newActiveId = idSet.has(state.activeLayerId) ? remaining[0].id : state.activeLayerId
      return {
        ...pushUndo(state),
        project: { ...state.project, layers: remaining },
        activeLayerId: newActiveId,
        selectedLayerIds: [newActiveId],
        frameSelection: null,
        selectedObjectIds: [],
      }
    }),

}))
