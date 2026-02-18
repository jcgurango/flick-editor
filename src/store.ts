import { create } from 'zustand'
import { createProject, createLayer, generateId } from './types/project'
import type { Project, Layer, Keyframe, TweenType, EaseDirection, FlickObject, FrameSelection, Clipboard, FrameClipboardLayer, FrameClipboardEntry, ClipDefinition, Timeline } from './types/project'
import { recenterPath, dragAttrs, applyNewBBox } from './lib/transform'
import { computeBBox, absoluteOrigin, rotatedCorners } from './lib/bbox'
import type { BBox } from './lib/bbox'
import { resolveFrame, resolveClipFrame } from './lib/interpolate'

const MAX_UNDO = 100

export interface EditContextEntry {
  type: 'group' | 'clip'
  objectId: string      // FlickObject.id on the parent keyframe
  layerId: string       // layer containing the object
  clipId?: string       // for clips: ClipDefinition.id
}

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

  // Edit context (group/clip editing)
  editContext: EditContextEntry[]
  _savedFrames: number[]
  enterGroup: (objectId: string, layerId: string) => void
  enterClip: (objectId: string, layerId: string, clipId: string) => void
  enterClipIsolated: (clipId: string) => void
  exitEditContext: () => void
  exitToStage: () => void

  // Clip actions
  createClipFromSelection: () => void
  renameClip: (clipId: string, name: string) => void
  deleteClipDefinition: (clipId: string) => void

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
  groupSelectedObjects: () => void
  ungroupSelectedObject: () => void
  updateObjectInEditContext: (objectId: string, attrs: Record<string, unknown>) => void
  deleteObjectsInEditContext: (objectIds: string[]) => void
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

/** Get the active timeline (project or clip) based on edit context. */
export function getActiveTimeline(state: EditorState): Timeline {
  // Find the last clip entry in editContext
  for (let i = state.editContext.length - 1; i >= 0; i--) {
    const entry = state.editContext[i]
    if (entry.type === 'clip' && entry.clipId) {
      const clip = state.project.clips.find((c: ClipDefinition) => c.id === entry.clipId)
      if (clip) return clip
    }
  }
  return state.project
}

/** Compute actual content bounds for each clip definition (union bbox of objects at frame 1). */
export function getClipDimensions(project: Project): Map<string, BBox> {
  const dims = new Map<string, BBox>()
  for (const clip of project.clips) {
    const objects = clip.layers
      .filter((l) => l.visible)
      .flatMap((l) => resolveFrame(l, 1, clip.totalFrames))
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of objects) {
      const bb = computeBBox(obj, dims)
      if (!bb) continue
      const rot = (obj.attrs.rotation as number) ?? 0
      const origin = absoluteOrigin(obj, bb)
      const corners = rotatedCorners(bb, rot, origin)
      for (const [cx, cy] of corners) {
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
      }
    }
    if (isFinite(minX)) {
      dims.set(clip.id, { x: minX, y: minY, width: maxX - minX, height: maxY - minY })
    } else {
      dims.set(clip.id, { x: 0, y: 0, width: 0, height: 0 })
    }
  }
  return dims
}

/** Get the active layers array based on edit context. */
function getActiveLayers(state: EditorState): Layer[] {
  return getActiveTimeline(state).layers
}


/** Update layers in the active timeline (project or clip) and return updated project. */
export function updateActiveLayers(state: EditorState, updater: (layers: Layer[]) => Layer[]): Project {
  const clipEntry = findActiveClipEntry(state)
  if (clipEntry) {
    return {
      ...state.project,
      clips: state.project.clips.map((c: ClipDefinition) =>
        c.id !== clipEntry.clipId ? c : { ...c, layers: updater(c.layers) },
      ),
    }
  }
  return { ...state.project, layers: updater(state.project.layers) }
}

/** Find the active clip entry in edit context (last one), or null. */
function findActiveClipEntry(state: EditorState): EditContextEntry | null {
  for (let i = state.editContext.length - 1; i >= 0; i--) {
    if (state.editContext[i].type === 'clip') return state.editContext[i]
  }
  return null
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
    editContext: [],
    _savedFrames: [],
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
    const layer = getActiveLayers(s).find((l) => l.id === s.activeLayerId)
    const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
    if (!layer || !kf) return
    const objs = kf.objects.filter((o) => s.selectedObjectIds.includes(o.id))
    if (objs.length === 0) return
    set({ clipboard: { type: 'objects', layerId: layer.id, objects: JSON.parse(JSON.stringify(objs)) } })
  },
  pasteObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.type !== 'objects' || s.clipboard.objects.length === 0) return
    const activeLyrs = getActiveLayers(s)
    const layer = activeLyrs.find((l: Layer) => l.id === s.activeLayerId)
    if (!layer) return

    let kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    let preProject = s.project
    if (!kf) {
      const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(layer, s.currentFrame)))
      kf = { frame: s.currentFrame, objects, tween: 'discrete', easeDirection: 'in-out' }
      preProject = updateActiveLayers(s, (layers) =>
        layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: [...l.keyframes, kf!].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
          },
        ),
      )
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

    // Apply paste on top of the pre-project (which may have auto-created keyframe)
    const preState = { ...s, project: preProject }
    set({
      ...pushUndo(s),
      project: updateActiveLayers(preState, (layers) =>
        layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: l.keyframes.map((k: Keyframe) =>
              k.frame !== s.currentFrame ? k : { ...k, objects: [...k.objects, ...pasted] },
            ),
          },
        ),
      ),
      selectedObjectIds: pasted.map((o: FlickObject) => o.id),
    })
  },
  copyFrames: () => {
    const s = useStore.getState()
    if (!s.frameSelection) return
    const { layerIds, startFrame, endFrame } = s.frameSelection
    const frameCount = endFrame - startFrame + 1
    const clipLayers: FrameClipboardLayer[] = []
    const activeLyrs = getActiveLayers(s)

    for (const layerId of layerIds) {
      const layer = activeLyrs.find((l: Layer) => l.id === layerId)
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
    const activeLyrs = getActiveLayers(s)
    const activeIdx = activeLyrs.findIndex((l: Layer) => l.id === s.activeLayerId)
    if (activeIdx === -1) return

    const activeTimelineData = getActiveTimeline(s)
    let workingLayers: Layer[] = JSON.parse(JSON.stringify(activeLyrs))

    for (let li = 0; li < grid.layers.length; li++) {
      const destIdx = activeIdx + li
      if (destIdx >= workingLayers.length) break
      const destLayer = workingLayers[destIdx]
      const clipLayer = grid.layers[li]

      for (let offset = 0; offset < grid.frameCount; offset++) {
        const targetFrame = s.currentFrame + offset
        if (targetFrame > activeTimelineData.totalFrames) break
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
      project: updateActiveLayers(s, () => workingLayers),
    })
  },
  copyLayers: () => {
    const s = useStore.getState()
    if (s.selectedLayerIds.length === 0) return
    const layerSet = new Set(s.selectedLayerIds)
    const layers = getActiveLayers(s).filter((l: Layer) => layerSet.has(l.id))
    set({ clipboard: { type: 'layers', layers: JSON.parse(JSON.stringify(layers)) } })
  },
  pasteLayers: () => {
    const s: EditorState = useStore.getState()
    if (s.clipboard.type !== 'layers') return
    const activeLyrs = getActiveLayers(s)
    const activeIdx = activeLyrs.findIndex((l: Layer) => l.id === s.activeLayerId)
    if (activeIdx === -1) return
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
    set({
      ...pushUndo(s),
      project: updateActiveLayers(s, (layers) => {
        const result = [...layers]
        result.splice(activeIdx + 1, 0, ...newLayers)
        return result
      }),
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
      const timeline = getActiveTimeline(state)
      const frameDuration = 1000 / timeline.frameRate
      const maxFrame = timeline.totalFrames
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

  // Edit context
  editContext: [],
  _savedFrames: [],
  enterGroup: (objectId, layerId) =>
    set((state) => ({
      editContext: [...state.editContext, { type: 'group' as const, objectId, layerId }],
      selectedObjectIds: [],
      inspectorFocus: 'canvas' as const,
    })),
  enterClip: (objectId, layerId, clipId) =>
    set((state) => {
      const clip = state.project.clips.find((c: ClipDefinition) => c.id === clipId)
      if (!clip) return state
      // Resolve the clip's internal frame at the current parent frame
      const parentLayer = getActiveTimeline(state).layers.find((l) => l.id === layerId)
      const clipFrame = parentLayer
        ? resolveClipFrame(clip, parentLayer, objectId, state.currentFrame)
        : 1
      return {
        editContext: [...state.editContext, { type: 'clip' as const, objectId, layerId, clipId }],
        _savedFrames: [...state._savedFrames, state.currentFrame],
        currentFrame: clipFrame,
        activeLayerId: clip.layers[0]?.id ?? '',
        selectedLayerIds: clip.layers[0] ? [clip.layers[0].id] : [],
        selectedObjectIds: [],
        frameSelection: null,
        inspectorFocus: 'canvas' as const,
      }
    }),
  enterClipIsolated: (clipId) => {
    set((state) => {
      const clip = state.project.clips.find((c: ClipDefinition) => c.id === clipId)
      if (!clip) return state
      return {
        editContext: [{ type: 'clip' as const, objectId: '', layerId: '', clipId }],
        _savedFrames: [state.currentFrame],
        currentFrame: 1,
        activeLayerId: clip.layers[0]?.id ?? '',
        selectedLayerIds: clip.layers[0] ? [clip.layers[0].id] : [],
        selectedObjectIds: [],
        frameSelection: null,
        inspectorFocus: 'canvas' as const,
      }
    })
    // Recenter on clip content after entering isolated mode
    useStore.getState().recenterView()
  },
  exitEditContext: () =>
    set((state) => {
      const popped = state.editContext[state.editContext.length - 1]
      const isClip = popped?.type === 'clip'
      const restoredFrame = isClip && state._savedFrames.length > 0
        ? state._savedFrames[state._savedFrames.length - 1]
        : state.currentFrame
      // When exiting a clip, restore parent frame and activeLayerId
      const parentCtx = state.editContext.length >= 2 ? state.editContext[state.editContext.length - 2] : null
      let activeLayerId = state.activeLayerId
      if (isClip) {
        if (parentCtx?.type === 'clip') {
          const parentClip = state.project.clips.find((c: ClipDefinition) => c.id === parentCtx.clipId)
          activeLayerId = parentClip?.layers[0]?.id ?? state.project.layers[0]?.id ?? ''
        } else {
          activeLayerId = popped.layerId
        }
      }
      return {
        editContext: state.editContext.slice(0, -1),
        _savedFrames: isClip ? state._savedFrames.slice(0, -1) : state._savedFrames,
        currentFrame: restoredFrame,
        activeLayerId,
        selectedLayerIds: [activeLayerId],
        selectedObjectIds: [],
        frameSelection: null,
        inspectorFocus: 'canvas' as const,
      }
    }),
  exitToStage: () =>
    set((state) => ({
      editContext: [],
      _savedFrames: [],
      currentFrame: state._savedFrames.length > 0 ? state._savedFrames[0] : state.currentFrame,
      activeLayerId: state.project.layers[0]?.id ?? '',
      selectedLayerIds: state.project.layers[0] ? [state.project.layers[0].id] : [],
      selectedObjectIds: [],
      frameSelection: null,
      inspectorFocus: 'canvas' as const,
    })),

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

    // Isolated clip view: fit to content bounds
    const isolated = s.editContext.length > 0 && s.editContext[0].type === 'clip' && !s.editContext[0].layerId
    if (isolated) {
      const tl = getActiveTimeline(s)
      const allObjs = tl.layers
        .filter((l) => l.visible)
        .flatMap((l) => resolveFrame(l, s.currentFrame, tl.totalFrames))
      const clipDims = getClipDimensions(s.project)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const obj of allObjs) {
        const bb = computeBBox(obj, clipDims)
        if (!bb) continue
        const rot = (obj.attrs.rotation as number) ?? 0
        const origin = absoluteOrigin(obj, bb)
        const corners = rotatedCorners(bb, rot, origin)
        for (const [cx, cy] of corners) {
          if (cx < minX) minX = cx
          if (cx > maxX) maxX = cx
          if (cy < minY) minY = cy
          if (cy > maxY) maxY = cy
        }
      }
      if (!isFinite(minX)) {
        // No content — just center on origin
        set({ zoom: 1, pan: { x: cw / 2, y: ch / 2 } })
        return
      }
      const contentW = maxX - minX
      const contentH = maxY - minY
      const contentCx = (minX + maxX) / 2
      const contentCy = (minY + maxY) / 2
      const fitZoom = Math.min(
        (cw - padding * 2) / (contentW || 1),
        (ch - padding * 2) / (contentH || 1),
        4, // cap max zoom for tiny content
      )
      set({
        zoom: fitZoom,
        pan: {
          x: cw / 2 - contentCx * fitZoom,
          y: ch / 2 - contentCy * fitZoom,
        },
      })
      return
    }

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

    // Isolated clip view: center on origin at 100%
    const isolated = s.editContext.length > 0 && s.editContext[0].type === 'clip' && !s.editContext[0].layerId
    if (isolated) {
      set({ zoom: 1, pan: { x: cw / 2, y: ch / 2 } })
      return
    }

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
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) =>
          layer.id !== layerId ? layer : {
            ...layer,
            keyframes: layer.keyframes.map((kf) => kf.frame !== frame ? kf : { ...kf, tween }),
          },
        ),
      ),
    })),

  setKeyframeEaseDirection: (layerId, frame, easeDirection) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) =>
          layer.id !== layerId ? layer : {
            ...layer,
            keyframes: layer.keyframes.map((kf) => kf.frame !== frame ? kf : { ...kf, easeDirection }),
          },
        ),
      ),
    })),

  updateObjectAttrs: (layerId, frame, objectId, attrs) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) =>
          layer.id !== layerId ? layer : {
            ...layer,
            keyframes: layer.keyframes.map((kf) =>
              kf.frame !== frame ? kf : {
                ...kf,
                objects: kf.objects.map((obj) =>
                  obj.id !== objectId ? obj : { ...obj, attrs: { ...obj.attrs, ...attrs } },
                ),
              },
            ),
          },
        ),
      ),
    })),

  addObjectToKeyframe: (layerId, frame, object) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) =>
          layer.id !== layerId ? layer : {
            ...layer,
            keyframes: layer.keyframes.map((kf) =>
              kf.frame !== frame ? kf : { ...kf, objects: [...kf.objects, object] },
            ),
          },
        ),
      ),
    })),

  setFrameRate: (fps) =>
    set((state) => {
      const clipEntry = findActiveClipEntry(state)
      if (clipEntry) {
        return {
          ...pushUndo(state),
          project: {
            ...state.project,
            clips: state.project.clips.map((c: ClipDefinition) =>
              c.id !== clipEntry.clipId ? c : { ...c, frameRate: fps },
            ),
          },
        }
      }
      return { ...pushUndo(state), project: { ...state.project, frameRate: fps } }
    }),

  setProjectDimensions: (width, height) =>
    set((state) => {
      const clipEntry = findActiveClipEntry(state)
      if (clipEntry) {
        return {
          ...pushUndo(state),
          project: {
            ...state.project,
            clips: state.project.clips.map((c: ClipDefinition) =>
              c.id !== clipEntry.clipId ? c : { ...c, width, height },
            ),
          },
        }
      }
      return { ...pushUndo(state), project: { ...state.project, width, height } }
    }),

  setTotalFrames: (totalFrames) =>
    set((state) => {
      const clipEntry = findActiveClipEntry(state)
      if (clipEntry) {
        return {
          ...pushUndo(state),
          project: {
            ...state.project,
            clips: state.project.clips.map((c: ClipDefinition) =>
              c.id !== clipEntry.clipId ? c : { ...c, totalFrames },
            ),
          },
        }
      }
      return {
        ...pushUndo(state),
        project: { ...state.project, totalFrames },
      }
    }),

  renameLayer: (layerId, name) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) => layer.id !== layerId ? layer : { ...layer, name }),
      ),
    })),

  toggleLayerVisibility: (layerId) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) => layer.id !== layerId ? layer : { ...layer, visible: !layer.visible }),
      ),
    })),

  toggleLayerLocked: (layerId) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) => layer.id !== layerId ? layer : { ...layer, locked: !layer.locked }),
      ),
    })),

  setAllLayersVisible: (visible) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) => ({ ...layer, visible })),
      ),
    })),

  setAllLayersLocked: (locked) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) => ({ ...layer, locked })),
      ),
    })),

  insertKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = getActiveLayers(state).find((l: Layer) => l.id === layerId)
      if (!layer) return state
      if (layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      const objects: FlickObject[] = JSON.parse(JSON.stringify(resolveFrame(layer, frame)))
      const newKf: Keyframe = { frame, objects, tween: 'discrete', easeDirection: 'in-out' }
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: [...l.keyframes, newKf].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
            },
          ),
        ),
      }
    }),

  insertBlankKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = getActiveLayers(state).find((l: Layer) => l.id === layerId)
      if (!layer) return state
      if (layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      const newKf: Keyframe = { frame, objects: [], tween: 'discrete', easeDirection: 'in-out' }
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: [...l.keyframes, newKf].sort((a: Keyframe, b: Keyframe) => a.frame - b.frame),
            },
          ),
        ),
      }
    }),

  reorderObject: (layerId, objectId, newIndex) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((l: Layer) =>
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
      ),
    })),

  moveObjectToLayer: (objectId, fromLayerId, toLayerId, insertIndex) =>
    set((state) => {
      if (fromLayerId === toLayerId) return state
      const activeLayers = getActiveLayers(state)
      const fromLayer = activeLayers.find((l: Layer) => l.id === fromLayerId)
      if (!fromLayer) return state

      const objByFrame = new Map<number, FlickObject>()
      for (const kf of fromLayer.keyframes) {
        const obj = kf.objects.find((o: FlickObject) => o.id === objectId)
        if (obj) objByFrame.set(kf.frame, obj)
      }
      if (objByFrame.size === 0) return state

      const fallbackObj = objByFrame.values().next().value!

      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) => {
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
        ),
      }
    }),

  addLayer: () =>
    set((state) => {
      const activeLyrs = getActiveLayers(state)
      const activeIdx = activeLyrs.findIndex((l: Layer) => l.id === state.activeLayerId)
      const insertAt = activeIdx === -1 ? activeLyrs.length : activeIdx + 1
      const existingNames = new Set(activeLyrs.map((l: Layer) => l.name))
      let name = 'Layer'
      let n = 1
      while (existingNames.has(name)) { n++; name = `Layer ${n}` }
      const newLayer = createLayer(name)
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) => {
          const result = [...layers]
          result.splice(insertAt, 0, newLayer)
          return result
        }),
        activeLayerId: newLayer.id,
        selectedLayerIds: [newLayer.id],
      }
    }),

  reorderLayer: (layerId, newIndex) =>
    set((state) => {
      const activeLyrs = getActiveLayers(state)
      const idx = activeLyrs.findIndex((l: Layer) => l.id === layerId)
      if (idx === -1 || idx === newIndex) return state
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) => {
          const result = [...layers]
          const [layer] = result.splice(idx, 1)
          const adjustedIndex = idx < newIndex ? newIndex - 1 : newIndex
          const insertIdx = Math.min(adjustedIndex, result.length)
          result.splice(insertIdx, 0, layer)
          return result
        }),
      }
    }),

  reorderLayers: (layerIds, newIndex) =>
    set((state) => {
      const idSet = new Set(layerIds)
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) => {
          const aboveCount = layers.filter(
            (l: Layer, i: number) => idSet.has(l.id) && i < newIndex,
          ).length
          const remaining = layers.filter((l: Layer) => !idSet.has(l.id))
          const moving = layers.filter((l: Layer) => idSet.has(l.id))
          const insertAt = Math.min(newIndex - aboveCount, remaining.length)
          const result = [...remaining]
          result.splice(insertAt, 0, ...moving)
          return result
        }),
      }
    }),

  setKeyframeLoop: (layerId, frame, loop) =>
    set((state) => ({
      ...pushUndo(state),
      project: updateActiveLayers(state, (layers) =>
        layers.map((layer) =>
          layer.id !== layerId ? layer : {
            ...layer,
            keyframes: layer.keyframes.map((kf) => kf.frame !== frame ? kf : { ...kf, loop }),
          },
        ),
      ),
    })),

  moveKeyframe: (layerId, fromFrame, toFrame) =>
    set((state) => {
      if (fromFrame === toFrame) return state
      const layer = getActiveLayers(state).find((l: Layer) => l.id === layerId)
      if (!layer) return state
      const kfIdx = layer.keyframes.findIndex((k: Keyframe) => k.frame === fromFrame)
      if (kfIdx === -1) return state
      const existingIdx = layer.keyframes.findIndex((k: Keyframe) => k.frame === toFrame)
      const newKeyframes = [...layer.keyframes]
      if (existingIdx !== -1) {
        newKeyframes.splice(existingIdx, 1)
      }
      const movedIdx = newKeyframes.findIndex((k: Keyframe) => k.frame === fromFrame)
      newKeyframes[movedIdx] = { ...newKeyframes[movedIdx], frame: toFrame }
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) => l.id !== layerId ? l : { ...l, keyframes: newKeyframes }),
        ),
      }
    }),

  deleteSelectedObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.selectedObjectIds.length === 0) return
    const activeLyrs = getActiveLayers(s)
    const kfs = activeLyrs
      .map(l => l.keyframes.find((k: Keyframe) => k.frame === s.currentFrame))
      .filter(Boolean)

    if (!kfs.length) return
    const idsToDelete = new Set(s.selectedObjectIds)
    set({
      ...pushUndo(s),
      project: updateActiveLayers(s, (layers) =>
        layers.map((l: Layer) => ({
          ...l,
          keyframes: l.keyframes.map((k: Keyframe) =>
            !kfs.includes(k) ? k : {
              ...k,
              objects: k.objects.filter((o: FlickObject) => !idsToDelete.has(o.id)),
            },
          ),
        })),
      ),
      selectedObjectIds: [],
    })
  },

  deleteKeyframe: (layerId, frame) =>
    set((state) => {
      const layer = getActiveLayers(state).find((l: Layer) => l.id === layerId)
      if (!layer) return state
      if (!layer.keyframes.some((kf: Keyframe) => kf.frame === frame)) return state
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) =>
            l.id !== layerId ? l : {
              ...l,
              keyframes: l.keyframes.filter((kf: Keyframe) => kf.frame !== frame),
            },
          ),
        ),
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
        project: updateActiveLayers(state, (layers) =>
          layers.map((l: Layer) =>
            !layerSet.has(l.id) ? l : {
              ...l,
              keyframes: l.keyframes.filter((kf: Keyframe) =>
                kf.frame < startFrame || kf.frame > endFrame,
              ),
            },
          ),
        ),
        frameSelection: null,
      }
    }),

  deleteLayer: (layerId) =>
    set((state) => {
      const activeLyrs = getActiveLayers(state)
      if (activeLyrs.length <= 1) return state
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.filter((l: Layer) => l.id !== layerId),
        ),
        activeLayerId: state.activeLayerId === layerId ? activeLyrs.find((l: Layer) => l.id !== layerId)!.id : state.activeLayerId,
        selectedLayerIds: [state.activeLayerId === layerId ? activeLyrs.find((l: Layer) => l.id !== layerId)!.id : state.activeLayerId],
        frameSelection: null,
        selectedObjectIds: [],
      }
    }),

  deleteSelectedLayers: () =>
    set((state) => {
      const idSet = new Set(state.selectedLayerIds)
      const activeLyrs = getActiveLayers(state)
      const remaining = activeLyrs.filter((l: Layer) => !idSet.has(l.id))
      if (remaining.length === 0) return state
      const newActiveId = idSet.has(state.activeLayerId) ? remaining[0].id : state.activeLayerId
      return {
        ...pushUndo(state),
        project: updateActiveLayers(state, (layers) =>
          layers.filter((l: Layer) => !idSet.has(l.id)),
        ),
        activeLayerId: newActiveId,
        selectedLayerIds: [newActiveId],
        frameSelection: null,
        selectedObjectIds: [],
      }
    }),

  groupSelectedObjects: () => {
    const s: EditorState = useStore.getState()
    if (s.selectedObjectIds.length < 2) return
    const layer = getActiveLayers(s).find((l: Layer) => l.id === s.activeLayerId)
    if (!layer) return
    const kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) return

    const selectedSet = new Set(s.selectedObjectIds)
    const selectedObjs = kf.objects.filter((o: FlickObject) => selectedSet.has(o.id))
    if (selectedObjs.length < 2) return

    // Compute union bbox center → group origin
    const cdims = getClipDimensions(s.project)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of selectedObjs) {
      const bbox = computeBBox(obj, cdims)
      if (!bbox) continue
      if (bbox.x < minX) minX = bbox.x
      if (bbox.y < minY) minY = bbox.y
      if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width
      if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height
    }
    if (!isFinite(minX)) return
    const gx = (minX + maxX) / 2
    const gy = (minY + maxY) / 2

    // Offset each child's position by -origin (make relative to group)
    const children: FlickObject[] = selectedObjs.map((obj: FlickObject) => {
      const offsetAttrs = dragAttrs(obj.type, obj.attrs, -gx, -gy)
      return { ...obj, attrs: { ...obj.attrs, ...offsetAttrs } }
    })

    const groupId = generateId()
    const groupObj: FlickObject = {
      id: groupId,
      type: 'group',
      attrs: { x: gx, y: gy, rotation: 0, scaleX: 1, scaleY: 1, children },
    }

    // Replace selected objects with the group on THIS keyframe only
    // Insert group at the position of the first selected object
    const firstSelectedIdx = kf.objects.findIndex((o: FlickObject) => selectedSet.has(o.id))
    const remaining = kf.objects.filter((o: FlickObject) => !selectedSet.has(o.id))
    const newObjects = [...remaining]
    newObjects.splice(Math.min(firstSelectedIdx, newObjects.length), 0, groupObj)

    set({
      ...pushUndo(s),
      project: updateActiveLayers(s, (layers) =>
        layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: l.keyframes.map((k: Keyframe) =>
              k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
            ),
          },
        ),
      ),
      selectedObjectIds: [groupId],
    })
  },

  updateObjectInEditContext: (objectId, attrs) => {
    const s: EditorState = useStore.getState()
    if (s.editContext.length === 0) return

    const ctx = s.editContext
    const lastEntry = ctx[ctx.length - 1]

    // If the last entry is a clip, the object is directly on the active clip's layers
    if (lastEntry.type === 'clip') {
      set({
        ...pushUndo(s),
        project: updateActiveLayers(s, (layers) =>
          layers.map((l: Layer) => ({
            ...l,
            keyframes: l.keyframes.map((kf: Keyframe) =>
              kf.frame !== s.currentFrame ? kf : {
                ...kf,
                objects: kf.objects.map((obj: FlickObject) =>
                  obj.id !== objectId ? obj : { ...obj, attrs: { ...obj.attrs, ...attrs } },
                ),
              },
            ),
          })),
        ),
      })
      return
    }

    // Last entry is a group — find the most recent clip (if any) to determine the base layers
    let clipIdx = -1; for (let i = ctx.length - 1; i >= 0; i--) { if (ctx[i].type === 'clip') { clipIdx = i; break } }
    if (clipIdx !== -1) {
      // Groups after the last clip entry, within clip layers
      const groupsAfterClip = ctx.slice(clipIdx + 1)
      const clipLayers = getActiveLayers(s)
      const groupRoot = groupsAfterClip[0]
      const groupLayer = clipLayers.find((l: Layer) => l.id === groupRoot.layerId)
      if (!groupLayer) return
      const kf = groupLayer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
      if (!kf) return

      function updateInGroupChain(objects: FlickObject[], depth: number): FlickObject[] {
        const targetId = groupsAfterClip[depth].objectId
        return objects.map((obj: FlickObject) => {
          if (obj.id !== targetId) return obj
          if (depth === groupsAfterClip.length - 1) {
            const children = (obj.attrs.children as FlickObject[]) ?? []
            const newChildren = children.map((child: FlickObject) =>
              child.id !== objectId ? child : { ...child, attrs: { ...child.attrs, ...attrs } },
            )
            return { ...obj, attrs: { ...obj.attrs, children: newChildren } }
          }
          const children = (obj.attrs.children as FlickObject[]) ?? []
          return { ...obj, attrs: { ...obj.attrs, children: updateInGroupChain(children, depth + 1) } }
        })
      }

      const newObjects = updateInGroupChain(kf.objects, 0)
      set({
        ...pushUndo(s),
        project: updateActiveLayers(s, (layers) =>
          layers.map((l: Layer) =>
            l.id !== groupLayer.id ? l : {
              ...l,
              keyframes: l.keyframes.map((k: Keyframe) =>
                k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
              ),
            },
          ),
        ),
      })
      return
    }

    // Pure group edit context (no clips): navigate project.layers
    const rootEntry = ctx[0]
    const layer = s.project.layers.find((l: Layer) => l.id === rootEntry.layerId)
    if (!layer) return
    const kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) return

    function updateInObjects(objects: FlickObject[], depth: number): FlickObject[] {
      const targetId = ctx[depth].objectId
      return objects.map((obj: FlickObject) => {
        if (obj.id !== targetId) return obj
        if (depth === ctx.length - 1) {
          const children = (obj.attrs.children as FlickObject[]) ?? []
          const newChildren = children.map((child: FlickObject) =>
            child.id !== objectId ? child : { ...child, attrs: { ...child.attrs, ...attrs } },
          )
          return { ...obj, attrs: { ...obj.attrs, children: newChildren } }
        }
        const children = (obj.attrs.children as FlickObject[]) ?? []
        return { ...obj, attrs: { ...obj.attrs, children: updateInObjects(children, depth + 1) } }
      })
    }

    const newObjects = updateInObjects(kf.objects, 0)
    set({
      ...pushUndo(s),
      project: {
        ...s.project,
        layers: s.project.layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: l.keyframes.map((k: Keyframe) =>
              k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
            ),
          },
        ),
      },
    })
  },

  deleteObjectsInEditContext: (objectIds) => {
    const s: EditorState = useStore.getState()
    if (s.editContext.length === 0 || objectIds.length === 0) return

    const ctx = s.editContext
    const idsToDelete = new Set(objectIds)
    const lastEntry = ctx[ctx.length - 1]

    // If the last entry is a clip, delete from the active clip's layers
    if (lastEntry.type === 'clip') {
      set({
        ...pushUndo(s),
        project: updateActiveLayers(s, (layers) =>
          layers.map((l: Layer) => ({
            ...l,
            keyframes: l.keyframes.map((kf: Keyframe) =>
              kf.frame !== s.currentFrame ? kf : {
                ...kf,
                objects: kf.objects.filter((obj: FlickObject) => !idsToDelete.has(obj.id)),
              },
            ),
          })),
        ),
        selectedObjectIds: [],
      })
      return
    }

    // Last entry is a group — find the most recent clip (if any) to determine base layers
    let clipIdx = -1; for (let i = ctx.length - 1; i >= 0; i--) { if (ctx[i].type === 'clip') { clipIdx = i; break } }
    if (clipIdx !== -1) {
      const groupsAfterClip = ctx.slice(clipIdx + 1)
      const clipLayers = getActiveLayers(s)
      const groupRoot = groupsAfterClip[0]
      const groupLayer = clipLayers.find((l: Layer) => l.id === groupRoot.layerId)
      if (!groupLayer) return
      const kf = groupLayer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
      if (!kf) return

      function removeFromGroupChain(objects: FlickObject[], depth: number): FlickObject[] {
        const targetId = groupsAfterClip[depth].objectId
        return objects.map((obj: FlickObject) => {
          if (obj.id !== targetId) return obj
          if (depth === groupsAfterClip.length - 1) {
            const children = (obj.attrs.children as FlickObject[]) ?? []
            return { ...obj, attrs: { ...obj.attrs, children: children.filter((c: FlickObject) => !idsToDelete.has(c.id)) } }
          }
          const children = (obj.attrs.children as FlickObject[]) ?? []
          return { ...obj, attrs: { ...obj.attrs, children: removeFromGroupChain(children, depth + 1) } }
        })
      }

      const newObjects = removeFromGroupChain(kf.objects, 0)
      set({
        ...pushUndo(s),
        project: updateActiveLayers(s, (layers) =>
          layers.map((l: Layer) =>
            l.id !== groupLayer.id ? l : {
              ...l,
              keyframes: l.keyframes.map((k: Keyframe) =>
                k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
              ),
            },
          ),
        ),
        selectedObjectIds: [],
      })
      return
    }

    // Pure group edit context (no clips)
    const rootEntry = ctx[0]
    const layer = s.project.layers.find((l: Layer) => l.id === rootEntry.layerId)
    if (!layer) return
    const kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) return

    function removeFromObjects(objects: FlickObject[], depth: number): FlickObject[] {
      const targetId = ctx[depth].objectId
      return objects.map((obj: FlickObject) => {
        if (obj.id !== targetId) return obj
        if (depth === ctx.length - 1) {
          const children = (obj.attrs.children as FlickObject[]) ?? []
          return { ...obj, attrs: { ...obj.attrs, children: children.filter((c: FlickObject) => !idsToDelete.has(c.id)) } }
        }
        const children = (obj.attrs.children as FlickObject[]) ?? []
        return { ...obj, attrs: { ...obj.attrs, children: removeFromObjects(children, depth + 1) } }
      })
    }

    const newObjects = removeFromObjects(kf.objects, 0)
    set({
      ...pushUndo(s),
      project: {
        ...s.project,
        layers: s.project.layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: l.keyframes.map((k: Keyframe) =>
              k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
            ),
          },
        ),
      },
      selectedObjectIds: [],
    })
  },

  // ── Clip actions ──

  createClipFromSelection: () => {
    const s: EditorState = useStore.getState()
    if (s.selectedObjectIds.length === 0) return
    const layers = getActiveLayers(s)
    const layer = layers.find((l: Layer) => l.id === s.activeLayerId)
    if (!layer) return
    const kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) return

    const selectedSet = new Set(s.selectedObjectIds)
    const selectedObjs = kf.objects.filter((o: FlickObject) => selectedSet.has(o.id))
    if (selectedObjs.length === 0) return

    // Compute union bbox center → clip origin
    const cdimsClip = getClipDimensions(s.project)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of selectedObjs) {
      const bbox = computeBBox(obj, cdimsClip)
      if (!bbox) continue
      if (bbox.x < minX) minX = bbox.x
      if (bbox.y < minY) minY = bbox.y
      if (bbox.x + bbox.width > maxX) maxX = bbox.x + bbox.width
      if (bbox.y + bbox.height > maxY) maxY = bbox.y + bbox.height
    }
    if (!isFinite(minX)) return
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    // Offset each object to clip-local coords (centered at origin)
    const clipObjects: FlickObject[] = selectedObjs.map((obj: FlickObject) => {
      const offsetAttrs = dragAttrs(obj.type, obj.attrs, -cx, -cy)
      return { ...obj, attrs: { ...obj.attrs, ...offsetAttrs } }
    })

    // Create clip definition
    const clipId = generateId()
    const clipLayerId = generateId()
    const timeline = getActiveTimeline(s)
    const clipDef: ClipDefinition = {
      id: clipId,
      name: `Clip ${s.project.clips.length + 1}`,
      frameRate: timeline.frameRate,
      width: timeline.width,
      height: timeline.height,
      totalFrames: timeline.totalFrames,
      layers: [{
        id: clipLayerId,
        name: 'Layer 1',
        visible: true,
        locked: false,
        keyframes: [{ frame: 1, objects: clipObjects, tween: 'discrete', easeDirection: 'in-out' }],
      }],
    }

    // Create clip instance on stage
    const instanceId = generateId()
    const clipInstance: FlickObject = {
      id: instanceId,
      type: 'clip',
      attrs: { x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1, clipId },
    }

    // Replace selected objects with clip instance on THIS keyframe only
    const firstSelectedIdx = kf.objects.findIndex((o: FlickObject) => selectedSet.has(o.id))
    const remaining = kf.objects.filter((o: FlickObject) => !selectedSet.has(o.id))
    const newObjects = [...remaining]
    newObjects.splice(Math.min(firstSelectedIdx, newObjects.length), 0, clipInstance)

    const updatedProject = updateActiveLayers(s, (lyrs) =>
      lyrs.map((l: Layer) =>
        l.id !== layer.id ? l : {
          ...l,
          keyframes: l.keyframes.map((k: Keyframe) =>
            k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
          ),
        },
      ),
    )
    set({
      ...pushUndo(s),
      project: { ...updatedProject, clips: [...updatedProject.clips, clipDef] },
      selectedObjectIds: [instanceId],
    })
  },

  renameClip: (clipId, name) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        clips: state.project.clips.map((c: ClipDefinition) =>
          c.id !== clipId ? c : { ...c, name },
        ),
      },
    })),

  deleteClipDefinition: (clipId) =>
    set((state) => ({
      ...pushUndo(state),
      project: {
        ...state.project,
        clips: state.project.clips.filter((c: ClipDefinition) => c.id !== clipId),
      },
    })),

  ungroupSelectedObject: () => {
    const s: EditorState = useStore.getState()
    if (s.selectedObjectIds.length !== 1) return
    const layer = getActiveLayers(s).find((l: Layer) => l.id === s.activeLayerId)
    if (!layer) return
    const kf = layer.keyframes.find((k: Keyframe) => k.frame === s.currentFrame)
    if (!kf) return

    const groupObj = kf.objects.find((o: FlickObject) => o.id === s.selectedObjectIds[0])
    if (!groupObj || groupObj.type !== 'group') return

    const gx = (groupObj.attrs.x as number) ?? 0
    const gy = (groupObj.attrs.y as number) ?? 0
    const gScaleX = (groupObj.attrs.scaleX as number) ?? 1
    const gScaleY = (groupObj.attrs.scaleY as number) ?? 1
    const children = (groupObj.attrs.children as FlickObject[]) ?? []

    // Bake group transform (scale then translate) into each child
    const extracted: FlickObject[] = children.map((child: FlickObject) => {
      let newAttrs = { ...child.attrs }
      // If scale is non-trivial, bake it into the child's geometry
      if (gScaleX !== 1 || gScaleY !== 1) {
        const childBBox = computeBBox(child, getClipDimensions(s.project))
        if (childBBox) {
          const scaledBBox = {
            x: childBBox.x * gScaleX,
            y: childBBox.y * gScaleY,
            width: childBBox.width * Math.abs(gScaleX),
            height: childBBox.height * Math.abs(gScaleY),
          }
          const baked = applyNewBBox(child.type, child.attrs, scaledBBox, getClipDimensions(s.project))
          newAttrs = { ...newAttrs, ...baked }
        }
      }
      // Then translate by group position
      const offsetAttrs = dragAttrs(child.type, newAttrs, gx, gy)
      return { ...child, attrs: { ...newAttrs, ...offsetAttrs } }
    })

    // Replace group with flattened children on THIS keyframe only
    const groupIdx = kf.objects.findIndex((o: FlickObject) => o.id === groupObj.id)
    const newObjects = [...kf.objects]
    newObjects.splice(groupIdx, 1, ...extracted)

    set({
      ...pushUndo(s),
      project: updateActiveLayers(s, (layers) =>
        layers.map((l: Layer) =>
          l.id !== layer.id ? l : {
            ...l,
            keyframes: l.keyframes.map((k: Keyframe) =>
              k.frame !== s.currentFrame ? k : { ...k, objects: newObjects },
            ),
          },
        ),
      ),
      selectedObjectIds: extracted.map((o: FlickObject) => o.id),
    })
  },

}))
