import { create } from 'zustand'
import { createProject, createLayer, generateId } from './types/project'
import type { Project, TweenType, EaseDirection } from './types/project'

export interface SelectedKeyframe {
  layerId: string
  frame: number
}

interface EditorState {
  // Project
  project: Project
  setProject: (project: Project) => void

  // Playback
  currentFrame: number
  setCurrentFrame: (frame: number) => void
  isPlaying: boolean
  togglePlayback: () => void
  _playRafId: number | null

  // Selection
  activeLayerId: string
  setActiveLayerId: (id: string) => void
  selectedKeyframe: SelectedKeyframe | null
  setSelectedKeyframe: (kf: SelectedKeyframe | null) => void

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
}

function createDemoProject(): Project {
  const p = createProject('My Animation')
  const rectId = generateId()
  const rectId2 = generateId()

  p.layers[0].keyframes = [
    {
      frame: 1,
      tween: 'linear',
      easeDirection: 'in-out',
      objects: [
        {
          id: rectId,
          type: 'rect',
          attrs: { x: 200, y: 200, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 15, rx: 20, rotation: 0, originX: 300, originY: 275 },
        },
        {
          id: rectId2,
          type: 'rect',
          attrs: { x: 200, y: 400, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rx: 4 },
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
          attrs: { x: 800, y: 400, width: 400, height: 250, fill: '#ff6a4a', stroke: '#cc3322', strokeWidth: 2, rx: 4, rotation: 45, originX: 1000, originY: 525 },
        },
        {
          id: rectId2,
          type: 'rect',
          attrs: { x: 200, y: 500, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rx: 4 },
        },
      ],
    },
  ]

  const splatLayer = createLayer('Splat')
  const splatId = generateId()
  const splat1 = 'M600,700 C620,660 670,650 700,670 C730,650 780,660 800,700 C820,740 810,790 780,810 C800,830 790,870 760,880 C740,900 700,910 680,890 C660,910 620,900 600,880 C580,860 570,830 590,810 C560,790 550,740 600,700 Z'
  const splat2 = 'M580,680 C610,630 690,620 730,660 C770,630 820,670 810,720 C840,750 830,810 790,830 C810,860 780,900 740,900 C720,930 670,930 650,900 C620,920 580,890 580,860 C550,840 540,780 570,760 C540,730 550,690 580,680 Z'
  splatLayer.keyframes = [
    {
      frame: 1,
      tween: 'smooth',
      easeDirection: 'in-out',
      objects: [
        {
          id: splatId,
          type: 'path',
          attrs: { d: splat1, fill: '#e8443a', stroke: '#a02020', strokeWidth: 3 },
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
          attrs: { d: splat2, fill: '#44cc88', stroke: '#228855', strokeWidth: 3 },
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
          type: 'circle',
          attrs: { cx: 1400, cy: 300, r: 80, fill: '#44cc88', stroke: '#228855', strokeWidth: 2 },
        },
      ],
    },
  ]
  p.layers.push(layer2)
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Layer'))
  p.layers.push(createLayer('Background'))

  return p
}

const initialProject = createDemoProject()

export const useStore = create<EditorState>((set) => ({
  project: initialProject,
  setProject: (project) => set({ project }),

  currentFrame: 1,
  setCurrentFrame: (currentFrame) => set({ currentFrame }),
  isPlaying: false,
  _playRafId: null,
  togglePlayback: () => {
    const state = useStore.getState()
    if (state.isPlaying) {
      // Stop
      if (state._playRafId !== null) cancelAnimationFrame(state._playRafId)
      set({ isPlaying: false, _playRafId: null })
    } else {
      const frameDuration = 1000 / state.project.frameRate
      const maxFrame = 60 // TODO: derive from project content
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

  activeLayerId: initialProject.layers[0].id,
  setActiveLayerId: (activeLayerId) => set({ activeLayerId }),
  selectedKeyframe: null,
  setSelectedKeyframe: (selectedKeyframe) => set({ selectedKeyframe }),

  zoom: 1,
  setZoom: (zoom) => set({ zoom }),
  pan: { x: 0, y: 0 },
  setPan: (pan) => set({ pan }),
  containerSize: { width: 0, height: 0 },
  setContainerSize: (containerSize) => set({ containerSize }),

  setKeyframeTween: (layerId, frame, tween) =>
    set((state) => ({
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
}))
