import { create } from 'zustand'
import { createProject, createLayer, generateId } from './types/project'
import type { Project, Layer, Keyframe, TweenType, EaseDirection, FlickObject } from './types/project'
import { recenterPath } from './lib/transform'

export interface SelectedKeyframe {
  layerId: string
  frame: number
}

const MAX_UNDO = 100

interface EditorState {
  // Project
  project: Project
  setProject: (project: Project) => void

  // Undo/Redo
  _undoStack: Project[]
  _redoStack: Project[]
  undo: () => void
  redo: () => void

  // Clipboard
  clipboard: FlickObject[]
  copySelectedObjects: () => void
  pasteObjects: () => void

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
  selectedKeyframe: SelectedKeyframe | null
  setSelectedKeyframe: (kf: SelectedKeyframe | null) => void
  selectedObjectIds: string[]
  setSelectedObjectIds: (ids: string[]) => void
  toggleSelectedObjectId: (id: string) => void

  // Viewport
  zoom: number
  setZoom: (zoom: number) => void
  pan: { x: number; y: number }
  setPan: (pan: { x: number; y: number }) => void
  containerSize: { width: number; height: number }
  setContainerSize: (size: { width: number; height: number }) => void

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
  clipboard: [],
  copySelectedObjects: () => {
    const s = useStore.getState()
    const layer = s.project.layers.find((l) => l.id === s.activeLayerId)
    const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
    if (!kf) return
    const objs = kf.objects.filter((o) => s.selectedObjectIds.includes(o.id))
    if (objs.length === 0) return
    // Deep clone
    set({ clipboard: JSON.parse(JSON.stringify(objs)) })
  },
  pasteObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.length === 0) return
    const layer = s.project.layers.find((l: Layer) => l.id === s.activeLayerId)
    const kf = layer?.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!layer || !kf) return

    const existingIds = new Set(kf.objects.map((o: FlickObject) => o.id))
    const pasted: FlickObject[] = s.clipboard.map((obj: FlickObject) => {
      const clone: FlickObject = JSON.parse(JSON.stringify(obj))
      if (existingIds.has(clone.id)) {
        clone.id = generateId()
      }
      return clone
    })

    const newProject: Project = {
      ...s.project,
      layers: s.project.layers.map((l: Layer) =>
        l.id !== layer.id ? l : {
          ...l,
          keyframes: l.keyframes.map((k: Keyframe) =>
            k.frame !== kf.frame ? k : { ...k, objects: [...k.objects, ...pasted] },
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
  selectedKeyframe: null,
  setSelectedKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),
  selectedObjectIds: [],
  setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
  toggleSelectedObjectId: (id) =>
    set((state) => ({
      selectedObjectIds: state.selectedObjectIds.includes(id)
        ? state.selectedObjectIds.filter((oid) => oid !== id)
        : [...state.selectedObjectIds, id],
    })),

  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  pan: { x: 0, y: 0 },
  setPan: (pan) => set({ pan }),
  containerSize: { width: 0, height: 0 },
  setContainerSize: (containerSize) => set({ containerSize }),

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

}))
