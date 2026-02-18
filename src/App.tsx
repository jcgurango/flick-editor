import { useState, useRef, useCallback, useLayoutEffect, useEffect, useMemo } from 'react'
import { useStore, getActiveTimeline, getClipDimensions } from './store'
import { getActiveKeyframe, getNextKeyframe, generateId, getSingleSelectedKeyframe, createProject } from './types/project'
import type { Layer } from './types/project'
import { resolveFrame } from './lib/interpolate'
import { dragAttrs, computeScale, computeRotationAttrs } from './lib/transform'
import { computeBBox, absoluteOrigin, rotatedCorners } from './lib/bbox'
import type { BBox } from './lib/bbox'
import type { HandleId, RotateCorner } from './components/BoundingBox'
import type { FlickObject } from './types/project'
import { SvgObject, ClipRenderContext } from './components/SvgObject'
import { BoundingBox } from './components/BoundingBox'
import { Inspector } from './components/Inspector'
import { Hierarchy } from './components/Hierarchy'
import { ClipLibrary } from './components/ClipLibrary'
import { MenuBar } from './components/MenuBar'
import { CollapsiblePanel } from './components/CollapsiblePanel'
import { Breadcrumb } from './components/Breadcrumb'
import { openProject, saveProject, saveProjectAs, clearFileHandle } from './lib/file-io'
import './App.css'

const ZOOM_SENSITIVITY = 1.1
const MIN_ZOOM = 0.05
const MAX_ZOOM = 10
const FIT_PADDING = 40

const TOOLS = [
  { id: 'select', icon: '⊹', label: 'Select' },
  { id: 'transform', icon: '⤡', label: 'Free Transform' },
  { id: 'separator1', separator: true },
  { id: 'pen', icon: '✎', label: 'Pen' },
  { id: 'pencil', icon: '✏', label: 'Pencil' },
  { id: 'line', icon: '╱', label: 'Line' },
  { id: 'separator2', separator: true },
  { id: 'rect', icon: '▭', label: 'Rectangle' },
  { id: 'ellipse', icon: '◯', label: 'Ellipse' },
  { id: 'separator3', separator: true },
  { id: 'fill', icon: '◧', label: 'Paint Bucket' },
  { id: 'eyedropper', icon: '⊙', label: 'Eyedropper' },
  { id: 'separator4', separator: true },
  { id: 'hand', icon: '✋', label: 'Hand' },
  { id: 'zoom', icon: '⌕', label: 'Zoom' },
] as const

/**
 * Determine the display type of a frame cell in the timeline.
 */
function getFrameType(layer: Layer, frame: number): 'keyframe' | 'keyframe-empty' | 'tweened' | 'held' | 'empty' {
  for (const kf of layer.keyframes) {
    if (kf.frame === frame) return kf.objects.length > 0 ? 'keyframe' : 'keyframe-empty'
  }
  const active = getActiveKeyframe(layer, frame)
  if (!active) return 'empty'

  // Check if the active keyframe has a non-discrete tween and there's a next keyframe
  if (active.tween !== 'discrete') {
    const next = getNextKeyframe(layer, active.frame)
    if (next && frame < next.frame) return 'tweened'
  }

  return 'held'
}

function App() {
  console.log(useStore())
  const project = useStore((s) => s.project)
  const clipDims = useMemo(() => getClipDimensions(project), [project])
  const currentFrame = useStore((s) => s.currentFrame)
  const setCurrentFrame = useStore((s) => s.setCurrentFrame)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const setSelectedLayerIds = useStore((s) => s.setSelectedLayerIds)
  const frameSelection = useStore((s) => s.frameSelection)
  const setFrameSelection = useStore((s) => s.setFrameSelection)
  const zoom = useStore((s) => s.zoom)
  const setZoom = useStore((s) => s.setZoom)
  const pan = useStore((s) => s.pan)
  const setPan = useStore((s) => s.setPan)
  const containerSize = useStore((s) => s.containerSize)
  const setContainerSize = useStore((s) => s.setContainerSize)
  const isPlaying = useStore((s) => s.isPlaying)
  const togglePlayback = useStore((s) => s.togglePlayback)
  const activeTool = useStore((s) => s.activeTool)
  const setActiveTool = useStore((s) => s.setActiveTool)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const setSelectedObjectIds = useStore((s) => s.setSelectedObjectIds)
  const toggleSelectedObjectId = useStore((s) => s.toggleSelectedObjectId)
  const toggleLayerVisibility = useStore((s) => s.toggleLayerVisibility)
  const toggleLayerLocked = useStore((s) => s.toggleLayerLocked)
  const setAllLayersVisible = useStore((s) => s.setAllLayersVisible)
  const setAllLayersLocked = useStore((s) => s.setAllLayersLocked)
  const reorderLayer = useStore((s) => s.reorderLayer)
  const documentName = useStore((s) => s.documentName)
  const editContext = useStore((s) => s.editContext)

  // Active timeline: project or clip depending on edit context
  const activeTimeline = useStore((s) => getActiveTimeline(s))
  const activeLayers = activeTimeline.layers
  const activeTotalFrames = activeTimeline.totalFrames

  // Document title
  useEffect(() => {
    document.title = documentName ? `${documentName} - Flick` : 'Flick'
  }, [documentName])

  // Layer drag state for timeline
  const [timelineLayerDrag, setTimelineLayerDrag] = useState<string | null>(null)
  const [timelineLayerDropIdx, setTimelineLayerDropIdx] = useState<number | null>(null)

  // Drag preview: a ghost object shown during dragging (not yet committed)
  const [dragPreview, setDragPreview] = useState<FlickObject | null>(null)
  // Scale preview: a ghost object shown during scaling (not yet committed)
  const [scalePreview, setScalePreview] = useState<FlickObject | null>(null)
  // Rotation preview: a ghost object shown during rotation (not yet committed)
  const [rotatePreview, setRotatePreview] = useState<FlickObject | null>(null)
  // Draw preview: shape being drawn with rect/ellipse tool
  const [drawPreview, setDrawPreview] = useState<FlickObject | null>(null)
  // Box select marquee (canvas-space coordinates)
  const [boxSelectRect, setBoxSelectRect] = useState<BBox | null>(null)

  // Panel resize
  const [timelineHeight, setTimelineHeight] = useState(200)
  const [inspectorWidth, setInspectorWidth] = useState(240)

  const handleTimelineResize = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startY = e.clientY
    const startH = timelineHeight
    const onMove = (ev: MouseEvent) => {
      setTimelineHeight(Math.max(80, Math.min(600, startH - (ev.clientY - startY))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [timelineHeight])

  const handleInspectorResize = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startW = inspectorWidth
    const onMove = (ev: MouseEvent) => {
      setInspectorWidth(Math.max(160, Math.min(500, startW - (ev.clientX - startX))))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [inspectorWidth])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        togglePlayback()
        return
      }

      // Escape: exit edit context
      if (e.key === 'Escape') {
        const s = useStore.getState()
        if (s.editContext.length > 0) {
          e.preventDefault()
          s.exitEditContext()
          return
        }
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        useStore.getState().undo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault()
        useStore.getState().redo()
        return
      }

      // Copy/Paste
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault()
        const s = useStore.getState()
        if (s.inspectorFocus === 'layer' && s.selectedLayerIds.length > 0) {
          s.copyLayers()
        } else if (s.frameSelection) {
          s.copyFrames()
        } else if (s.selectedObjectIds.length > 0) {
          s.copySelectedObjects()
        }
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault()
        const s = useStore.getState()
        if (s.clipboard.type === 'layers') {
          s.pasteLayers()
        } else if (s.clipboard.type === 'frames') {
          s.pasteFrames()
        } else {
          s.pasteObjects()
        }
        return
      }

      // Insert keyframe (F6) / blank keyframe (F7)
      if (e.key === 'F6' || e.key === 'F7') {
        e.preventDefault()
        const s = useStore.getState()
        const sel = getSingleSelectedKeyframe(s.frameSelection)
        const layerId = sel?.layerId ?? s.activeLayerId
        if (layerId) {
          if (e.key === 'F6') {
            s.insertKeyframe(layerId, s.currentFrame)
          } else {
            s.insertBlankKeyframe(layerId, s.currentFrame)
          }
          s.setFrameSelection({ layerIds: [layerId], startFrame: s.currentFrame, endFrame: s.currentFrame })
        }
        return
      }

      // Create clip (F8)
      if (e.key === 'F8') {
        e.preventDefault()
        useStore.getState().createClipFromSelection()
        return
      }

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const s = useStore.getState()
        if (s.editContext.length > 0 && s.selectedObjectIds.length > 0) {
          s.deleteObjectsInEditContext(s.selectedObjectIds)
        } else if (s.inspectorFocus === 'canvas' && s.selectedObjectIds.length > 0) {
          s.deleteSelectedObjects()
        } else if (s.inspectorFocus === 'timeline' && s.frameSelection) {
          s.deleteFrameSelection()
        } else if (s.inspectorFocus === 'layer' && s.selectedLayerIds.length > 0) {
          s.deleteSelectedLayers()
        } else {
          s.deleteSelectedLayers()
        }
        return
      }

      // File operations
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && !e.shiftKey) {
        e.preventDefault()
        clearFileHandle()
        const s = useStore.getState()
        s.resetProject(createProject())
        s.setDocumentName('')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o' && !e.shiftKey) {
        e.preventDefault()
        openProject().then((result) => {
          if (result) {
            const s = useStore.getState()
            s.resetProject(result.project)
            s.setDocumentName(result.name)
          }
        })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault()
        saveProject(useStore.getState().project).then((name) => {
          if (name) useStore.getState().setDocumentName(name)
        })
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && e.shiftKey) {
        e.preventDefault()
        saveProjectAs(useStore.getState().project).then((name) => {
          if (name) useStore.getState().setDocumentName(name)
        })
        return
      }

      // View shortcuts
      if (e.key === '/' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        useStore.getState().setView100()
        return
      }
      if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        useStore.getState().recenterView()
        return
      }

      // Select All
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        const s = useStore.getState()
        if (s.editContext.length > 0) {
          // In edit context: select all children of the current group
          const ctx = s.editContext
          const rootLayer = s.project.layers.find((l) => l.id === ctx[0].layerId)
          if (rootLayer) {
            const kf = rootLayer.keyframes.find((k) => k.frame === s.currentFrame)
            if (kf) {
              let objs: FlickObject[] = kf.objects
              for (const entry of ctx) {
                const grp = objs.find((o) => o.id === entry.objectId)
                if (grp?.type === 'group') objs = (grp.attrs.children as FlickObject[]) ?? []
                else break
              }
              s.setSelectedObjectIds(objs.map((o) => o.id))
            }
          }
        } else {
          // Select all objects on current frame across visible unlocked layers (keyframes only)
          const ids: string[] = []
          for (const layer of s.project.layers) {
            if (!layer.visible || layer.locked) continue
            const kf = layer.keyframes.find((k) => k.frame === s.currentFrame)
            if (kf) for (const obj of kf.objects) ids.push(obj.id)
          }
          s.setSelectedObjectIds(ids)
        }
        s.setInspectorFocus('canvas')
        return
      }

      // Group / Ungroup
      if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
        e.preventDefault()
        useStore.getState().groupSelectedObjects()
        return
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'G' || (e.key === 'g' && e.shiftKey))) {
        e.preventDefault()
        useStore.getState().ungroupSelectedObject()
        return
      }

      // Arrow key nudge
      const s = useStore.getState()
      if (s.selectedObjectIds.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0

        if (s.editContext.length > 0) {
          // Nudge within edit context — need to resolve the group's children
          // For simplicity, use updateObjectInEditContext for each selected child
          for (const objId of s.selectedObjectIds) {
            // We need to find the child object to compute dragAttrs
            // Walk the edit context to find the innermost group's children
            const ctx = s.editContext
            let currentObjs: FlickObject[] = []
            const rootLayer = s.project.layers.find((l) => l.id === ctx[0].layerId)
            if (rootLayer) {
              const kf = rootLayer.keyframes.find((k) => k.frame === s.currentFrame)
              if (kf) {
                currentObjs = kf.objects
                for (const entry of ctx) {
                  const grp = currentObjs.find((o) => o.id === entry.objectId)
                  if (grp?.type === 'group') {
                    currentObjs = (grp.attrs.children as FlickObject[]) ?? []
                  }
                }
              }
            }
            const obj = currentObjs.find((o) => o.id === objId)
            if (obj) {
              const newAttrs = dragAttrs(obj.type, obj.attrs, dx, dy)
              s.updateObjectInEditContext(obj.id, newAttrs)
            }
          }
        } else {
          for (const objId of s.selectedObjectIds) {
            for (const layer of s.project.layers) {
              if (layer.locked) continue
              const kf = layer.keyframes.find((k) => k.frame === s.currentFrame)
              const obj = kf?.objects.find((o) => o.id === objId)
              if (kf && obj) {
                const newAttrs = dragAttrs(obj.type, obj.attrs, dx, dy)
                s.updateObjectAttrs(layer.id, kf.frame, obj.id, newAttrs)
                break
              }
            }
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [togglePlayback])

  // Resolve group being edited (if in edit context)
  // Groups rotate around (x, y) so transform = translate(x,y) rotate(rot) scale(sx,sy)
  // This composes cleanly: just concatenate per-group transforms and track an affine matrix.
  const editTarget = (() => {
    if (editContext.length === 0) return null
    const rootEntry = editContext[0]

    // Isolated clip edit: no parent layer/object, clip shown standalone
    const isIsolated = rootEntry.type === 'clip' && !rootEntry.layerId
    if (isIsolated) {
      return {
        children: null,
        isClipEdit: true,
        isIsolated: true,
        transformStr: '',
        groupX: 0, groupY: 0,
        mat: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number],
        layerId: '',
      }
    }

    const savedFrames = useStore.getState()._savedFrames

    // Start from the project's layers for the first entry
    let currentLayers = project.layers
    let frameForLevel = savedFrames[0] ?? currentFrame
    let totalFramesForLevel = project.totalFrames

    const layer = currentLayers.find((l) => l.id === rootEntry.layerId)
    if (!layer) return null

    let currentObjs: FlickObject[] = resolveFrame(layer, frameForLevel, totalFramesForLevel)
    const transformParts: string[] = []
    let isClipEdit = false
    // Track the layer at the current edit depth (for entering nested groups/clips)
    let currentLayerId = rootEntry.layerId

    // Affine matrix [a, b, c, d, tx, ty] for local→canvas mapping
    let ma = 1, mb = 0, mc = 0, md = 1, mtx = 0, mty = 0
    const compose = (a2: number, b2: number, c2: number, d2: number, tx2: number, ty2: number) => {
      const na = ma * a2 + mc * b2, nb = mb * a2 + md * b2
      const nc = ma * c2 + mc * d2, nd = mb * c2 + md * d2
      const ntx = ma * tx2 + mc * ty2 + mtx, nty = mb * tx2 + md * ty2 + mty
      ma = na; mb = nb; mc = nc; md = nd; mtx = ntx; mty = nty
    }

    for (let i = 0; i < editContext.length; i++) {
      const entry = editContext[i]
      const obj = currentObjs.find((o) => o.id === entry.objectId)
      if (!obj) return null

      if (obj.type !== 'group' && obj.type !== 'clip') return null

      const lx = (obj.attrs.x as number) ?? 0
      const ly = (obj.attrs.y as number) ?? 0
      const lr = (obj.attrs.rotation as number) ?? 0
      const lsx = (obj.attrs.scaleX as number) ?? 1
      const lsy = (obj.attrs.scaleY as number) ?? 1

      // translate(x, y) rotate(rot) scale(sx, sy)
      if (lx || ly) {
        transformParts.push(`translate(${lx}, ${ly})`)
        compose(1, 0, 0, 1, lx, ly)
      }
      if (lr !== 0) {
        transformParts.push(`rotate(${lr})`)
        const rad = (lr * Math.PI) / 180
        compose(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0)
      }
      if (lsx !== 1 || lsy !== 1) {
        transformParts.push(`scale(${lsx}, ${lsy})`)
        compose(lsx, 0, 0, lsy, 0, 0)
      }

      if (entry.type === 'clip') {
        if (i === editContext.length - 1) {
          // This is the innermost clip being edited
          isClipEdit = true
          break
        }
        // Not the last entry — descend into the clip's resolved layers for the next entry
        const clipDef = project.clips.find((c) => c.id === entry.clipId)
        if (!clipDef) return null
        // The frame inside this clip: use the saved frame for the next level
        frameForLevel = savedFrames[i + 1] ?? 1
        totalFramesForLevel = clipDef.totalFrames
        const nextEntry = editContext[i + 1]
        const clipLayer = clipDef.layers.find((l) => l.id === nextEntry.layerId)
        if (!clipLayer) return null
        currentObjs = resolveFrame(clipLayer, frameForLevel, totalFramesForLevel)
        currentLayerId = nextEntry.layerId
      } else {
        // Group: descend into children (stay on same layer)
        currentObjs = (obj.attrs.children as FlickObject[]) ?? []
      }
    }

    return {
      children: isClipEdit ? null : currentObjs, // null for clip edit (uses activeLayers instead)
      isClipEdit,
      isIsolated: false,
      transformStr: transformParts.join(' '),
      // World position of local origin (0,0)
      groupX: mtx, groupY: mty,
      // Affine matrix for local→canvas mapping (also used for inverse delta conversion)
      mat: [ma, mb, mc, md, mtx, mty] as [number, number, number, number, number, number],
      layerId: currentLayerId,
    }
  })()

  // Keep a ref to editTarget for use in event handlers (avoids stale closures)
  const editTargetRef = useRef(editTarget)
  editTargetRef.current = editTarget

  // Canvas refs
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Drag refs
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const dragObjRef = useRef<{ id: string; layerId: string; type: string; attrs: Record<string, unknown> } | null>(null)

  // Scale refs
  const isScalingRef = useRef(false)
  const scaleStartRef = useRef({ x: 0, y: 0 })
  const scaleHandleRef = useRef<HandleId>('corner-tl')
  const scaleObjRef = useRef<{ id: string; layerId: string; type: string; attrs: Record<string, unknown> } | null>(null)

  // Rotation refs
  const isRotatingRef = useRef(false)
  const rotateRefAngleRef = useRef(0)  // reference angle in radians (adjusted on pivot change)
  const rotatePivotRef = useRef<[number, number]>([0, 0])  // current rotation pivot
  const rotateOrigRotRef = useRef(0)  // original rotation in degrees
  const rotateLastShiftRef = useRef(false)
  const rotateCornerRef = useRef<RotateCorner>('tl')
  const rotateObjRef = useRef<{
    id: string; layerId: string; type: string; attrs: Record<string, unknown>
  } | null>(null)

  // Drawing refs
  const isDrawingRef = useRef(false)
  const drawStartRef = useRef({ x: 0, y: 0 })
  const drawIdRef = useRef('')

  // Box select refs
  const isBoxSelectingRef = useRef(false)
  const boxSelectStartRef = useRef({ x: 0, y: 0 })

  // Timeline
  const scrubWrapperRef = useRef<HTMLDivElement>(null)

  // Measure container and compute initial zoom-to-fit
  useLayoutEffect(() => {
    const el = canvasAreaRef.current
    if (!el) return

    const measure = () => {
      const { clientWidth, clientHeight } = el
      setContainerSize({ width: clientWidth, height: clientHeight })

      const scaleX = (clientWidth - FIT_PADDING * 2) / project.width
      const scaleY = (clientHeight - FIT_PADDING * 2) / project.height
      const fitZoom = Math.min(scaleX, scaleY)
      setZoom(fitZoom)
      setPan({
        x: (clientWidth - project.width * fitZoom) / 2,
        y: (clientHeight - project.height * fitZoom) / 2,
      })
    }

    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mousewheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault()
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const direction = e.deltaY < 0 ? 1 : -1
      const factor = direction > 0 ? ZOOM_SENSITIVITY : 1 / ZOOM_SENSITIVITY
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))

      const newPanX = mouseX - ((mouseX - pan.x) / zoom) * newZoom
      const newPanY = mouseY - ((mouseY - pan.y) / zoom) * newZoom

      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    },
    [zoom, pan, setZoom, setPan],
  )

  // SVG mousedown: pan (select + shift) or start drawing (rect/ellipse tool)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (e.button !== 0) return
      const s = useStore.getState()

      if (s.activeTool === 'select' && e.shiftKey) {
        e.preventDefault()
        isPanningRef.current = true
        panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        canvasAreaRef.current!.style.cursor = 'grabbing'
        return
      }

      if (s.activeTool === 'select' && !e.shiftKey) {
        // Start box select on empty canvas
        e.preventDefault()
        const svgRect = e.currentTarget.getBoundingClientRect()
        const startX = (e.clientX - svgRect.left - s.pan.x) / s.zoom
        const startY = (e.clientY - svgRect.top - s.pan.y) / s.zoom
        isBoxSelectingRef.current = true
        boxSelectStartRef.current = { x: startX, y: startY }
        return
      }

      if (s.activeTool === 'rect' || s.activeTool === 'ellipse') {
        e.preventDefault()
        const svgRect = e.currentTarget.getBoundingClientRect()
        const startX = (e.clientX - svgRect.left - s.pan.x) / s.zoom
        const startY = (e.clientY - svgRect.top - s.pan.y) / s.zoom
        isDrawingRef.current = true
        drawStartRef.current = { x: startX, y: startY }
        drawIdRef.current = generateId()
      }
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (isPanningRef.current) {
        setPan({
          x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
          y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
        })
        return
      }

      if (isDraggingRef.current && dragObjRef.current) {
        const s = useStore.getState()
        // Total delta from drag start (not incremental) in canvas space
        let dx = (e.clientX - dragStartRef.current.x) / s.zoom
        let dy = (e.clientY - dragStartRef.current.y) / s.zoom
        // Convert canvas delta to group-local delta using inverse affine matrix
        const et = editTargetRef.current
        if (et) {
          const [a, b, c, d] = et.mat
          const det = a * d - b * c
          if (Math.abs(det) > 1e-10) {
            const ldx = (d * dx - c * dy) / det
            const ldy = (-b * dx + a * dy) / det
            dx = ldx; dy = ldy
          }
        }
        const { id, type, attrs } = dragObjRef.current
        const newAttrs = dragAttrs(type, attrs, dx, dy)
        // Don't commit — store as preview
        setDragPreview({ id, type, attrs: { ...attrs, ...newAttrs } })
        return
      }

      if (isScalingRef.current && scaleObjRef.current) {
        const s = useStore.getState()
        // Total delta from drag start (not incremental) in canvas space
        let dx = (e.clientX - scaleStartRef.current.x) / s.zoom
        let dy = (e.clientY - scaleStartRef.current.y) / s.zoom
        // Convert canvas delta to group-local delta using inverse affine matrix
        const et = editTargetRef.current
        if (et) {
          const [a, b, c, d] = et.mat
          const det = a * d - b * c
          if (Math.abs(det) > 1e-10) {
            const ldx = (d * dx - c * dy) / det
            const ldy = (-b * dx + a * dy) / det
            dx = ldx; dy = ldy
          }
        }
        const { id, type, attrs } = scaleObjRef.current
        const bbox = computeBBox({ id, type, attrs }, clipDims)
        if (!bbox) return
        const rotation = (attrs.rotation as number) ?? 0
        const newAttrs = computeScale(
          type, attrs, bbox, scaleHandleRef.current,
          dx, dy, rotation, e.shiftKey, e.ctrlKey, clipDims,
        )
        // Don't commit — store as preview
        setScalePreview({ id, type, attrs: { ...attrs, ...newAttrs } })
        return
      }

      if (isRotatingRef.current && rotateObjRef.current) {
        const s = useStore.getState()
        const rect = e.currentTarget.getBoundingClientRect()
        let mouseX = (e.clientX - rect.left - s.pan.x) / s.zoom
        let mouseY = (e.clientY - rect.top - s.pan.y) / s.zoom

        // When in edit context, convert mouse to local space (pivot is in local space)
        const et = editTargetRef.current
        if (et) {
          const [a, b, c, d, tx, ty] = et.mat
          const det = a * d - b * c
          if (Math.abs(det) > 1e-10) {
            const lx = mouseX - tx, ly = mouseY - ty
            mouseX = (d * lx - c * ly) / det
            mouseY = (-b * lx + a * ly) / det
          }
        }

        const { id, type, attrs } = rotateObjRef.current

        // Live pivot switching when shift toggles
        if (e.shiftKey !== rotateLastShiftRef.current) {
          const [opx, opy] = rotatePivotRef.current
          const oldAngle = Math.atan2(mouseY - opy, mouseX - opx)
          const oldDelta = oldAngle - rotateRefAngleRef.current

          const bbox = computeBBox({ id, type, attrs }, clipDims)
          if (bbox) {
            const rot = (attrs.rotation as number) ?? 0
            const origin = absoluteOrigin({ id, type, attrs }, bbox)
            const rCorners = rotatedCorners(bbox, rot, origin)
            let newPivot: [number, number]
            if (e.shiftKey) {
              const opp: Record<string, number> = { tl: 2, tr: 3, bl: 1, br: 0 }
              newPivot = rCorners[opp[rotateCornerRef.current]]
            } else {
              newPivot = [
                (rCorners[0][0] + rCorners[1][0] + rCorners[2][0] + rCorners[3][0]) / 4,
                (rCorners[0][1] + rCorners[1][1] + rCorners[2][1] + rCorners[3][1]) / 4,
              ]
            }
            const newAngle = Math.atan2(mouseY - newPivot[1], mouseX - newPivot[0])
            rotateRefAngleRef.current = newAngle - oldDelta
            rotatePivotRef.current = newPivot
          }
          rotateLastShiftRef.current = e.shiftKey
        }

        const [px, py] = rotatePivotRef.current
        const currentAngle = Math.atan2(mouseY - py, mouseX - px)
        const rawDeltaDeg = ((currentAngle - rotateRefAngleRef.current) * 180) / Math.PI
        let newRotation = rotateOrigRotRef.current + rawDeltaDeg

        // Normalize to 0-360
        newRotation = ((newRotation % 360) + 360) % 360

        // Snap to 15 degree increments unless ctrl is held
        if (!e.ctrlKey) {
          newRotation = Math.round(newRotation / 15) * 15
        }

        const bbox = computeBBox({ id, type, attrs }, clipDims)
        if (!bbox) return
        const rotAttrs = computeRotationAttrs(
          type, attrs, bbox, rotatePivotRef.current, newRotation,
        )
        // Don't commit — store as preview
        setRotatePreview({ id, type, attrs: { ...attrs, ...rotAttrs } })
        return
      }

      if (isBoxSelectingRef.current) {
        const s = useStore.getState()
        const rect = e.currentTarget.getBoundingClientRect()
        const curX = (e.clientX - rect.left - s.pan.x) / s.zoom
        const curY = (e.clientY - rect.top - s.pan.y) / s.zoom
        const { x: sx, y: sy } = boxSelectStartRef.current
        setBoxSelectRect({
          x: Math.min(sx, curX),
          y: Math.min(sy, curY),
          width: Math.abs(curX - sx),
          height: Math.abs(curY - sy),
        })
        return
      }

      if (isDrawingRef.current) {
        const s = useStore.getState()
        const rect = e.currentTarget.getBoundingClientRect()
        const curX = (e.clientX - rect.left - s.pan.x) / s.zoom
        const curY = (e.clientY - rect.top - s.pan.y) / s.zoom
        const { x: sx, y: sy } = drawStartRef.current
        let w = curX - sx
        let h = curY - sy

        // Shift: constrain to square/circle
        if (e.shiftKey) {
          const size = Math.max(Math.abs(w), Math.abs(h))
          w = (w >= 0 ? 1 : -1) * size
          h = (h >= 0 ? 1 : -1) * size
        }

        const id = drawIdRef.current
        if (s.activeTool === 'rect') {
          setDrawPreview({
            id,
            type: 'rect',
            attrs: {
              x: w >= 0 ? sx : sx + w,
              y: h >= 0 ? sy : sy + h,
              width: Math.abs(w),
              height: Math.abs(h),
              fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rotation: 0,
            },
          })
        } else if (s.activeTool === 'ellipse') {
          setDrawPreview({
            id,
            type: 'ellipse',
            attrs: {
              cx: sx + w / 2,
              cy: sy + h / 2,
              rx: Math.abs(w) / 2,
              ry: Math.abs(h) / 2,
              fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rotation: 0,
            },
          })
        }
      }
    },
    [setPan, clipDims],
  )

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      canvasAreaRef.current!.style.cursor = ''
    }
    // Commit drag preview on mouseup
    if (isDraggingRef.current && dragPreview && dragObjRef.current) {
      const s = useStore.getState()
      const { layerId } = dragObjRef.current
      const original = dragObjRef.current.attrs
      const changed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(dragPreview.attrs)) {
        if (v !== original[k]) changed[k] = v
      }
      if (Object.keys(changed).length > 0) {
        if (s.editContext.length > 0) {
          s.updateObjectInEditContext(dragPreview.id, changed)
        } else {
          s.updateObjectAttrs(layerId, s.currentFrame, dragPreview.id, changed)
        }
      }
    }
    isDraggingRef.current = false
    dragObjRef.current = null
    setDragPreview(null)

    // Box select
    if (isBoxSelectingRef.current) {
      isBoxSelectingRef.current = false
      useStore.getState().setInspectorFocus('canvas')
      if (boxSelectRect && (boxSelectRect.width > 2 || boxSelectRect.height > 2)) {
        // Find all objects whose rotated AABB intersects the marquee
        const s = useStore.getState()
        const hits: string[] = []
        const boxSelectLayers = getActiveTimeline(s).layers
        for (const layer of boxSelectLayers) {
          if (!layer.visible || layer.locked) continue
          if (!layer.keyframes.some((kf) => kf.frame === s.currentFrame)) continue
          const objects = resolveFrame(layer, s.currentFrame, getActiveTimeline(s).totalFrames)
          for (const obj of objects) {
            const bbox = computeBBox(obj, clipDims)
            if (!bbox) continue
            const rot = (obj.attrs.rotation as number) ?? 0
            const origin = absoluteOrigin(obj, bbox)
            const corners = rotatedCorners(bbox, rot, origin)
            // Compute AABB of rotated corners
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
            for (const [cx, cy] of corners) {
              if (cx < minX) minX = cx
              if (cx > maxX) maxX = cx
              if (cy < minY) minY = cy
              if (cy > maxY) maxY = cy
            }
            // AABB intersection test
            const r = boxSelectRect
            if (minX <= r.x + r.width && maxX >= r.x && minY <= r.y + r.height && maxY >= r.y) {
              hits.push(obj.id)
            }
          }
        }
        if (e.ctrlKey || e.metaKey) {
          // Ctrl: add hits to existing selection
          const merged = new Set([...s.selectedObjectIds, ...hits])
          s.setSelectedObjectIds([...merged])
        } else {
          s.setSelectedObjectIds(hits)
        }
      } else {
        // Tiny drag = click on empty canvas → deselect (unless ctrl held)
        if (!(e.ctrlKey || e.metaKey)) {
          const s = useStore.getState()
          s.setSelectedObjectIds([])
        }
      }
      setBoxSelectRect(null)
    }

    // Commit scale preview on mouseup
    if (isScalingRef.current && scalePreview && scaleObjRef.current) {
      const s = useStore.getState()
      const { layerId } = scaleObjRef.current
      const original = scaleObjRef.current.attrs
      const changed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(scalePreview.attrs)) {
        if (v !== original[k]) changed[k] = v
      }
      if (Object.keys(changed).length > 0) {
        if (s.editContext.length > 0) {
          s.updateObjectInEditContext(scalePreview.id, changed)
        } else {
          s.updateObjectAttrs(layerId, s.currentFrame, scalePreview.id, changed)
        }
      }
    }
    isScalingRef.current = false
    scaleObjRef.current = null
    setScalePreview(null)

    // Commit rotation preview on mouseup
    if (isRotatingRef.current && rotatePreview && rotateObjRef.current) {
      const s = useStore.getState()
      const { layerId } = rotateObjRef.current
      const original = rotateObjRef.current.attrs
      const changed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(rotatePreview.attrs)) {
        if (v !== original[k]) changed[k] = v
      }
      if (Object.keys(changed).length > 0) {
        if (s.editContext.length > 0) {
          s.updateObjectInEditContext(rotatePreview.id, changed)
        } else {
          s.updateObjectAttrs(layerId, s.currentFrame, rotatePreview.id, changed)
        }
      }
    }
    isRotatingRef.current = false
    rotateObjRef.current = null
    setRotatePreview(null)

    // Commit drawn shape
    if (isDrawingRef.current && drawPreview) {
      const s = useStore.getState()
      const layer = getActiveTimeline(s).layers.find((l) => l.id === s.activeLayerId)
      const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
      if (layer && kf) {
        const a = drawPreview.attrs as Record<string, number>
        const hasSize = drawPreview.type === 'rect'
          ? a.width > 1 && a.height > 1
          : a.rx > 1 && a.ry > 1
        if (hasSize) {
          s.addObjectToKeyframe(layer.id, kf.frame, drawPreview)
          s.setSelectedObjectIds([drawPreview.id])
        }
      }
    }
    isDrawingRef.current = false
    setDrawPreview(null)
  }, [dragPreview, scalePreview, rotatePreview, drawPreview, boxSelectRect])

  // Timeline scrubbing
  const isFrameSelectingRef = useRef(false)
  const frameSelectStartRef = useRef<{ layerIdx: number; frame: number } | null>(null)
  const [frameSelectEnd, setFrameSelectEnd] = useState<{ layerIdx: number; frame: number } | null>(null)
  const frameSelectEndRef = useRef(frameSelectEnd)
  frameSelectEndRef.current = frameSelectEnd
  const frameSelectShiftRef = useRef(false)

  // Keyframe drag state
  const [kfDrag, setKfDrag] = useState<{ layerId: string; fromFrame: number; toFrame: number } | null>(null)
  const kfDragRef = useRef(kfDrag)
  kfDragRef.current = kfDrag

  /** Compute frame number from mouse X on the unified timeline body (accounting for sticky layer column). */
  const frameFromX = useCallback(
    (ev: MouseEvent | React.MouseEvent) => {
      const wrapper = scrubWrapperRef.current
      if (!wrapper) return null
      const rect = wrapper.getBoundingClientRect()
      const x = ev.clientX - rect.left + wrapper.scrollLeft - 160 // layer column width
      if (x < 0) return null // clicked on layer column
      return Math.max(1, Math.min(activeTotalFrames, Math.floor(x / 16) + 1))
    },
    [activeTotalFrames],
  )

  /** Compute cell { layerIdx, frame } from mouse event. Returns null if on frame numbers row or layer column. */
  const cellFromEvent = useCallback(
    (ev: MouseEvent | React.MouseEvent) => {
      const wrapper = scrubWrapperRef.current
      if (!wrapper) return null
      const rect = wrapper.getBoundingClientRect()
      const y = ev.clientY - rect.top + wrapper.scrollTop - 20 // header row height
      if (y < 0) return null // frame numbers header
      const frame = frameFromX(ev)
      if (!frame) return null // layer column
      const layerIdx = Math.max(0, Math.min(activeLayers.length - 1, Math.floor(y / 28)))
      return { layerIdx, frame }
    },
    [activeLayers.length, frameFromX],
  )

  const handleTimelineMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const cell = cellFromEvent(e)

      if (!cell) {
        // Either frame numbers row or layer column
        const frame = frameFromX(e)
        if (!frame) return // Layer column — let layer click/drag handlers handle it
        // Frame numbers row — scrub playhead
        setCurrentFrame(frame)
        const onMove = (ev: MouseEvent) => {
          const f = frameFromX(ev)
          if (f) useStore.getState().setCurrentFrame(f)
        }
        const onUp = () => {
          document.removeEventListener('mousemove', onMove)
          document.removeEventListener('mouseup', onUp)
        }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        return
      }

      // Check if the clicked cell is a keyframe (for potential keyframe drag)
      const clickedLayer = activeLayers[cell.layerIdx]
      const isKeyframeCell = clickedLayer?.keyframes.some((k) => k.frame === cell.frame)

      // Clear previous selection immediately
      setFrameSelection(null)

      isFrameSelectingRef.current = true
      frameSelectStartRef.current = cell
      frameSelectShiftRef.current = e.shiftKey
      setFrameSelectEnd(cell)

      // Track whether we've switched to keyframe drag mode
      const isDraggingKf = { current: false }
      const startLayerIdx = cell.layerIdx

      // Move playhead immediately (unless shift)
      if (!e.shiftKey) {
        setCurrentFrame(cell.frame)
        setActiveLayerId(clickedLayer.id)
      }

      const onMove = (ev: MouseEvent) => {
        const end = cellFromEvent(ev)
        if (!end) return

        // If started on a keyframe and dragging horizontally within same layer, switch to keyframe drag
        if (isKeyframeCell && !isDraggingKf.current && end.layerIdx === startLayerIdx && end.frame !== cell.frame) {
          isDraggingKf.current = true
          isFrameSelectingRef.current = false
          setFrameSelectEnd(null)
        }

        if (isDraggingKf.current) {
          // Clamp to same layer, update drag target frame
          const targetFrame = Math.max(1, Math.min(activeTotalFrames, end.frame))
          setKfDrag({ layerId: clickedLayer.id, fromFrame: cell.frame, toFrame: targetFrame })
        } else if (isFrameSelectingRef.current) {
          setFrameSelectEnd(end)
        }
      }

      const onUp = () => {
        if (isDraggingKf.current) {
          // Commit keyframe move
          const drag = kfDragRef.current
          if (drag && drag.fromFrame !== drag.toFrame) {
            const targetLayer = getActiveTimeline(useStore.getState()).layers.find(l => l.id === drag.layerId)
            const hasExisting = targetLayer?.keyframes.some(k => k.frame === drag.toFrame)
            if (hasExisting) {
              if (confirm(`A keyframe already exists at frame ${drag.toFrame}. Replace it?`)) {
                useStore.getState().moveKeyframe(drag.layerId, drag.fromFrame, drag.toFrame)
              }
            } else {
              useStore.getState().moveKeyframe(drag.layerId, drag.fromFrame, drag.toFrame)
            }
          }
          setKfDrag(null)
        } else {
          isFrameSelectingRef.current = false
          const start = frameSelectStartRef.current
          const end = frameSelectEndRef.current
          if (start && end) {
            const minFrame = Math.min(start.frame, end.frame)
            const maxFrame = Math.max(start.frame, end.frame)
            const minLayer = Math.min(start.layerIdx, end.layerIdx)
            const maxLayer = Math.max(start.layerIdx, end.layerIdx)
            const layers = getActiveTimeline(useStore.getState()).layers
            const layerIds = layers.slice(minLayer, maxLayer + 1).map(l => l.id)
            useStore.getState().setFrameSelection({ layerIds, startFrame: minFrame, endFrame: maxFrame })
            useStore.getState().setInspectorFocus('timeline')
            if (!frameSelectShiftRef.current) {
              useStore.getState().setCurrentFrame(minFrame)
              useStore.getState().setActiveLayerId(layerIds[0])
            }
          }
          setFrameSelectEnd(null)
        }
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [cellFromEvent, frameFromX, setCurrentFrame, setActiveLayerId, setFrameSelection, activeLayers, activeTotalFrames],
  )

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <span className="header-logo">FLICK</span>
        <MenuBar />
      </div>

      {/* Main body */}
      <div className="main-body">
        {/* Toolbar */}
        <div className="toolbar">
          {TOOLS.map((tool) =>
            'separator' in tool ? (
              <div key={tool.id} className="tool-separator" />
            ) : (
              <button
                key={tool.id}
                className={`tool-btn${tool.id === activeTool ? ' active' : ''}`}
                title={tool.label}
                onClick={() => setActiveTool(tool.id)}
              >
                {tool.icon}
              </button>
            )
          )}
        </div>

        {/* Canvas */}
        <div
          className="canvas-area"
          ref={canvasAreaRef}
          style={editTarget?.isIsolated ? { background: '#ffffff' } : undefined}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('application/x-flick-clip')) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDrop={(e) => {
            const clipId = e.dataTransfer.getData('application/x-flick-clip')
            if (!clipId) return
            e.preventDefault()
            const s = useStore.getState()
            // Convert drop position to canvas coordinates
            const rect = canvasAreaRef.current!.getBoundingClientRect()
            const cx = (e.clientX - rect.left - s.pan.x) / s.zoom
            const cy = (e.clientY - rect.top - s.pan.y) / s.zoom
            // Find or create a keyframe on the active layer
            const activeLyrs = getActiveTimeline(s).layers
            const layer = activeLyrs.find((l) => l.id === s.activeLayerId)
            if (!layer || layer.locked) return
            const hasKf = layer.keyframes.some((k) => k.frame === s.currentFrame)
            if (!hasKf) {
              s.insertKeyframe(s.activeLayerId, s.currentFrame)
            }
            const instanceId = generateId()
            const clipInstance = {
              id: instanceId,
              type: 'clip' as const,
              attrs: { x: cx, y: cy, rotation: 0, scaleX: 1, scaleY: 1, clipId },
            }
            s.addObjectToKeyframe(s.activeLayerId, s.currentFrame, clipInstance)
            s.setSelectedObjectIds([instanceId])
            s.setInspectorFocus('canvas')
          }}
        >
          {containerSize.width > 0 && (
            <svg
              width={containerSize.width}
              height={containerSize.height}
              className="canvas-svg"
              style={activeTool !== 'select' ? { cursor: 'crosshair' } : undefined}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              <defs>
                <filter id="canvas-shadow" x="-5%" y="-5%" width="110%" height="110%">
                  <feDropShadow dx="0" dy="4" stdDeviation="10" floodColor="rgba(0,0,0,0.4)" />
                </filter>
              </defs>

              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                {/* Stage background */}
                {editTarget?.isIsolated ? (
                  /* Isolated clip view: invisible rect for pointer events (background is CSS) */
                  <rect
                    x={-1e6} y={-1e6} width={2e6} height={2e6}
                    fill="transparent"
                    pointerEvents="all"
                  />
                ) : (
                  <rect
                    x={0}
                    y={0}
                    width={project.width}
                    height={project.height}
                    fill="#e8e8e8"
                    filter="url(#canvas-shadow)"
                    pointerEvents="all"
                  />
                )}

                <g pointerEvents={activeTool === 'select' ? undefined : 'none'}>
                  {/* Normal mode: all layers interactive */}
                  {!editTarget && project.layers
                    .filter((l) => l.visible)
                    .slice()
                    .reverse()
                    .map((layer) => {
                      const objects = resolveFrame(layer, currentFrame, project.totalFrames)
                      const isOnKeyframe = layer.keyframes.some((kf) => kf.frame === currentFrame)
                      return (
                        <ClipRenderContext.Provider key={layer.id} value={{ project, parentLayer: layer, parentFrame: currentFrame }}>
                        <g data-layer-id={layer.id}>
                          {objects.map((obj) => (
                            <SvgObject
                              key={obj.id}
                              obj={obj}
                              onClick={activeTool === 'select' ? (e) => {
                                if (!isOnKeyframe || layer.locked) return
                                e.stopPropagation()
                                if (e.ctrlKey || e.metaKey) {
                                  toggleSelectedObjectId(obj.id)
                                } else {
                                  setSelectedObjectIds([obj.id])
                                }
                                setActiveLayerId(layer.id)
                                setFrameSelection(null)
                                useStore.getState().setInspectorFocus('canvas')
                              } : undefined}
                              onDoubleClick={activeTool === 'select' ? (e) => {
                                if (layer.locked) return
                                if (obj.type === 'group') {
                                  if (!isOnKeyframe) return
                                  e.stopPropagation()
                                  useStore.getState().enterGroup(obj.id, layer.id)
                                } else if (obj.type === 'clip') {
                                  const clipId = obj.attrs.clipId as string | undefined
                                  if (clipId) {
                                    e.stopPropagation()
                                    useStore.getState().enterClip(obj.id, layer.id, clipId)
                                  }
                                }
                              } : undefined}
                              onMouseDown={activeTool === 'select' ? (e) => {
                                if (e.button !== 0) return
                                if (!isOnKeyframe || layer.locked || e.shiftKey) return
                                if (e.ctrlKey || e.metaKey) return // ctrl-click handled in onClick
                                const kf = layer.keyframes.find((k) => k.frame === currentFrame)
                                const kfObj = kf?.objects.find((o) => o.id === obj.id)
                                if (!kfObj) return
                                e.stopPropagation()
                                isDraggingRef.current = true
                                dragStartRef.current = { x: e.clientX, y: e.clientY }
                                dragObjRef.current = { id: obj.id, layerId: layer.id, type: kfObj.type, attrs: { ...kfObj.attrs } }
                                const s = useStore.getState()
                                if (!s.selectedObjectIds.includes(obj.id)) {
                                  setSelectedObjectIds([obj.id])
                                }
                                setActiveLayerId(layer.id)
                                setFrameSelection(null)
                              } : undefined}
                            />
                          ))}
                        </g>
                        </ClipRenderContext.Provider>
                      )
                    })}
                  {/* Edit context mode: dim everything, interactive group/clip children */}
                  {editTarget && (() => {
                    // Resolve the objects to render interactively
                    // For clip edit, build per-layer groups so each gets proper ClipRenderContext
                    const editObjects: FlickObject[] = editTarget.isClipEdit
                      ? activeLayers
                          .filter((l) => l.visible)
                          .slice()
                          .reverse()
                          .flatMap((l) => resolveFrame(l, currentFrame, activeTotalFrames))
                      : (editTarget.children ?? [])
                    // For clip edit: build layer→objects map for context providers
                    const clipEditLayerObjects: { layer: Layer; objects: FlickObject[] }[] = editTarget.isClipEdit
                      ? activeLayers
                          .filter((l) => l.visible)
                          .slice()
                          .reverse()
                          .map((l) => ({ layer: l, objects: resolveFrame(l, currentFrame, activeTotalFrames) }))
                      : []

                    return (
                    <>
                      {/* Dimmed background: all project layers non-interactive (skip for isolated clip view) */}
                      {!editTarget.isIsolated && (
                      <g opacity={0.3} pointerEvents="none">
                        {project.layers
                          .filter((l) => l.visible)
                          .slice()
                          .reverse()
                          .map((layer) => {
                            const parentFrame = useStore.getState()._savedFrames[0] ?? currentFrame
                            const objects = resolveFrame(layer, parentFrame, project.totalFrames)
                            return (
                              <ClipRenderContext.Provider key={layer.id} value={{ project, parentLayer: layer, parentFrame }}>
                              <g>
                                {objects.map((obj) => (
                                  <SvgObject key={obj.id} obj={obj} />
                                ))}
                              </g>
                              </ClipRenderContext.Provider>
                            )
                          })}
                      </g>
                      )}
                      {/* Origin cross indicator */}
                      <g transform={`translate(${editTarget.groupX}, ${editTarget.groupY})`} pointerEvents="none">
                        <line x1={-12 / zoom} y1={0} x2={12 / zoom} y2={0} stroke="#ff4488" strokeWidth={1.5 / zoom} />
                        <line x1={0} y1={-12 / zoom} x2={0} y2={12 / zoom} stroke="#ff4488" strokeWidth={1.5 / zoom} />
                      </g>
                      {/* Interactive children (group children or clip layer objects) */}
                      <g transform={editTarget.transformStr}>
                        {editTarget.isClipEdit
                          ? clipEditLayerObjects.map(({ layer: clipLayer, objects: clipObjs }) => (
                              <ClipRenderContext.Provider key={clipLayer.id} value={{ project, parentLayer: clipLayer, parentFrame: currentFrame }}>
                                {clipObjs.map((obj) => (
                                  <SvgObject
                                    key={obj.id}
                                    obj={obj}
                                    onClick={activeTool === 'select' ? (e) => {
                                      e.stopPropagation()
                                      if (e.ctrlKey || e.metaKey) {
                                        toggleSelectedObjectId(obj.id)
                                      } else {
                                        setSelectedObjectIds([obj.id])
                                      }
                                      useStore.getState().setInspectorFocus('canvas')
                                    } : undefined}
                                    onDoubleClick={activeTool === 'select' ? (e) => {
                                      if (obj.type === 'group') {
                                        e.stopPropagation()
                                        useStore.getState().enterGroup(obj.id, clipLayer.id)
                                      } else if (obj.type === 'clip') {
                                        const clipId = obj.attrs.clipId as string | undefined
                                        if (clipId) {
                                          e.stopPropagation()
                                          useStore.getState().enterClip(obj.id, clipLayer.id, clipId)
                                        }
                                      }
                                    } : undefined}
                                    onMouseDown={activeTool === 'select' ? (e) => {
                                      if (e.button !== 0 || e.shiftKey) return
                                      if (e.ctrlKey || e.metaKey) return
                                      e.stopPropagation()
                                      isDraggingRef.current = true
                                      dragStartRef.current = { x: e.clientX, y: e.clientY }
                                      dragObjRef.current = { id: obj.id, layerId: clipLayer.id, type: obj.type, attrs: { ...obj.attrs } }
                                      const s = useStore.getState()
                                      if (!s.selectedObjectIds.includes(obj.id)) {
                                        setSelectedObjectIds([obj.id])
                                      }
                                    } : undefined}
                                  />
                                ))}
                              </ClipRenderContext.Provider>
                            ))
                          : editObjects.map((obj) => (
                          <SvgObject
                            key={obj.id}
                            obj={obj}
                            onClick={activeTool === 'select' ? (e) => {
                              e.stopPropagation()
                              if (e.ctrlKey || e.metaKey) {
                                toggleSelectedObjectId(obj.id)
                              } else {
                                setSelectedObjectIds([obj.id])
                              }
                              useStore.getState().setInspectorFocus('canvas')
                            } : undefined}
                            onDoubleClick={activeTool === 'select' ? (e) => {
                              if (obj.type === 'group') {
                                e.stopPropagation()
                                useStore.getState().enterGroup(obj.id, editTarget.layerId)
                              } else if (obj.type === 'clip') {
                                const clipId = obj.attrs.clipId as string | undefined
                                if (clipId) {
                                  e.stopPropagation()
                                  useStore.getState().enterClip(obj.id, editTarget.layerId, clipId)
                                }
                              }
                            } : undefined}
                            onMouseDown={activeTool === 'select' ? (e) => {
                              if (e.button !== 0 || e.shiftKey) return
                              if (e.ctrlKey || e.metaKey) return
                              e.stopPropagation()
                              isDraggingRef.current = true
                              dragStartRef.current = { x: e.clientX, y: e.clientY }
                              dragObjRef.current = { id: obj.id, layerId: editTarget.layerId, type: obj.type, attrs: { ...obj.attrs } }
                              const s = useStore.getState()
                              if (!s.selectedObjectIds.includes(obj.id)) {
                                setSelectedObjectIds([obj.id])
                              }
                            } : undefined}
                          />
                        ))}
                      </g>
                    </>
                    )
                  })()}
                </g>

                {/* Drag preview ghost */}
                {dragPreview && (
                  <ClipRenderContext.Provider value={{ project, parentLayer: activeLayers.find((l) => l.id === activeLayerId) ?? activeLayers[0], parentFrame: currentFrame }}>
                  <g opacity={0.4} transform={editTarget ? editTarget.transformStr : undefined}>
                    <SvgObject obj={dragPreview} />
                  </g>
                  </ClipRenderContext.Provider>
                )}

                {/* Scale preview ghost */}
                {scalePreview && (
                  <ClipRenderContext.Provider value={{ project, parentLayer: activeLayers.find((l) => l.id === activeLayerId) ?? activeLayers[0], parentFrame: currentFrame }}>
                  <g opacity={0.4} transform={editTarget ? editTarget.transformStr : undefined}>
                    <SvgObject obj={scalePreview} />
                  </g>
                  </ClipRenderContext.Provider>
                )}

                {/* Rotation preview ghost */}
                {rotatePreview && (
                  <ClipRenderContext.Provider value={{ project, parentLayer: activeLayers.find((l) => l.id === activeLayerId) ?? activeLayers[0], parentFrame: currentFrame }}>
                  <g opacity={0.4} transform={editTarget ? editTarget.transformStr : undefined}>
                    <SvgObject obj={rotatePreview} />
                  </g>
                  </ClipRenderContext.Provider>
                )}

                {/* Draw preview ghost */}
                {drawPreview && (
                  <g opacity={0.6}>
                    <SvgObject obj={drawPreview} />
                  </g>
                )}

                {/* Box select marquee */}
                {boxSelectRect && (
                  <rect
                    x={boxSelectRect.x}
                    y={boxSelectRect.y}
                    width={boxSelectRect.width}
                    height={boxSelectRect.height}
                    fill="rgba(74, 122, 255, 0.1)"
                    stroke="#4a7aff"
                    strokeWidth={1 / zoom}
                    strokeDasharray={`${4 / zoom} ${4 / zoom}`}
                    pointerEvents="none"
                  />
                )}

                {/* Bounding boxes for selected objects */}
                {activeTool === 'select' && selectedObjectIds.length > 0 && (() => {
                  // In edit context, find objects from the edit target; otherwise from all layers
                  const allObjects: FlickObject[] = editTarget
                    ? (editTarget.isClipEdit
                        ? activeLayers.filter((l) => l.visible).flatMap((l) => resolveFrame(l, currentFrame, activeTotalFrames))
                        : (editTarget.children ?? []))
                    : activeLayers
                        .filter((l) => l.visible)
                        .flatMap((l) => resolveFrame(l, currentFrame, activeTotalFrames))
                  const singleSelected = selectedObjectIds.length === 1
                  // Group offset for bounding boxes when in edit context

                  return selectedObjectIds.map((selId) => {
                    // During drag/scale/rotate, show bbox around preview
                    let selObj = (dragPreview && dragPreview.id === selId)
                      ? dragPreview
                      : (scalePreview && scalePreview.id === selId)
                        ? scalePreview
                        : (rotatePreview && rotatePreview.id === selId)
                          ? rotatePreview
                          : allObjects.find((o) => o.id === selId)
                    if (!selObj) return null
                    // When in edit context, offset the object's bbox to world coords
                    return (
                      <g key={selId} transform={editTarget ? editTarget.transformStr : undefined}>
                        <BoundingBox
                          obj={selObj}
                          zoom={zoom}
                          clipDimensions={clipDims}
                          onHandleMouseDown={singleSelected ? (handle, e) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            // In edit context, use editTarget children or clip layers; otherwise find from layer
                            const kfObj = editTarget
                              ? (editTarget.isClipEdit
                                  ? allObjects.find((o) => o.id === selId)
                                  : editTarget.children?.find((o) => o.id === selId))
                              : (() => {
                                  const layer = activeLayers.find((l) => l.id === activeLayerId)
                                  const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                                  return kf?.objects.find((o) => o.id === selId)
                                })()
                            const layerId = editTarget ? editTarget.layerId : activeLayerId
                            if (!kfObj) return
                            isScalingRef.current = true
                            scaleStartRef.current = { x: e.clientX, y: e.clientY }
                            scaleHandleRef.current = handle
                            scaleObjRef.current = { id: kfObj.id, layerId, type: kfObj.type, attrs: { ...kfObj.attrs } }
                          } : undefined}
                          onRotateMouseDown={singleSelected ? (corner: RotateCorner, e: React.MouseEvent) => {
                            if (e.button !== 0) return
                            e.stopPropagation()
                            const kfObj = editTarget
                              ? (editTarget.isClipEdit
                                  ? allObjects.find((o) => o.id === selId)
                                  : editTarget.children?.find((o) => o.id === selId))
                              : (() => {
                                  const layer = activeLayers.find((l) => l.id === activeLayerId)
                                  const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                                  return kf?.objects.find((o) => o.id === selId)
                                })()
                            const layerId = editTarget ? editTarget.layerId : activeLayerId
                            if (!kfObj) return

                            const bbox = computeBBox(kfObj, clipDims)
                            if (!bbox) return
                            const rot = (kfObj.attrs.rotation as number) ?? 0
                            const origin = absoluteOrigin(kfObj, bbox)
                            const rCorners = rotatedCorners(bbox, rot, origin)

                            let pivot: [number, number]
                            if (e.shiftKey) {
                              const oppositeIdx: Record<string, number> = { tl: 2, tr: 3, bl: 1, br: 0 }
                              pivot = rCorners[oppositeIdx[corner]]
                            } else {
                              pivot = [
                                (rCorners[0][0] + rCorners[1][0] + rCorners[2][0] + rCorners[3][0]) / 4,
                                (rCorners[0][1] + rCorners[1][1] + rCorners[2][1] + rCorners[3][1]) / 4,
                              ]
                            }

                            const svgRect = canvasAreaRef.current!.getBoundingClientRect()
                            const s = useStore.getState()
                            let startX = (e.clientX - svgRect.left - s.pan.x) / s.zoom
                            let startY = (e.clientY - svgRect.top - s.pan.y) / s.zoom

                            // When in edit context, convert mouse to local space (pivot is already local)
                            if (editTarget) {
                              const [a, b, c, d, tx, ty] = editTarget.mat
                              const det = a * d - b * c
                              if (Math.abs(det) > 1e-10) {
                                const lx = startX - tx, ly = startY - ty
                                startX = (d * lx - c * ly) / det
                                startY = (-b * lx + a * ly) / det
                              }
                            }

                            isRotatingRef.current = true
                            rotateRefAngleRef.current = Math.atan2(startY - pivot[1], startX - pivot[0])
                            rotatePivotRef.current = pivot
                            rotateOrigRotRef.current = rot
                            rotateLastShiftRef.current = e.shiftKey
                            rotateCornerRef.current = corner
                            rotateObjRef.current = { id: kfObj.id, layerId, type: kfObj.type, attrs: { ...kfObj.attrs } }
                          } : undefined}
                        />
                      </g>
                    )
                  })
                })()}
              </g>
            </svg>
          )}
        </div>

        {/* Inspector resize handle */}
        <div className="resize-handle-v" onMouseDown={handleInspectorResize} />

        {/* Inspector + Hierarchy */}
        <div style={{ width: inspectorWidth, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <CollapsiblePanel title="Inspector">
              <Inspector />
            </CollapsiblePanel>
            <CollapsiblePanel title="Hierarchy">
              <Hierarchy />
            </CollapsiblePanel>
            <CollapsiblePanel title="Clip Library">
              <ClipLibrary />
            </CollapsiblePanel>
          </div>
        </div>
      </div>

      {/* Timeline resize handle */}
      <div className="resize-handle-h" onMouseDown={handleTimelineResize} />

      {/* Timeline */}
      <div className="timeline" style={{ height: timelineHeight }}>
        <div className="timeline-toolbar">
          <button className="timeline-btn" title="Add Layer" onClick={() => useStore.getState().addLayer()}>+</button>
          <button className="timeline-btn" title="Delete Layer" onClick={() => useStore.getState().deleteSelectedLayers()}>−</button>
          <Breadcrumb />
          <div style={{ flex: 1 }} />
          <button className="timeline-btn" title="Previous Frame" onClick={() => setCurrentFrame(Math.max(1, currentFrame - 1))}>⏮</button>
          <button className="timeline-btn" title={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="timeline-btn" title="Next Frame" onClick={() => setCurrentFrame(Math.min(activeTotalFrames, currentFrame + 1))}>⏭</button>
          <div style={{ flex: 1 }} />
          <span className="timeline-frame-display">Frame {currentFrame}</span>
          <button className="timeline-btn" title="Add Keyframe" onClick={() => useStore.getState().insertKeyframe(activeLayerId, currentFrame)}>◆</button>
        </div>

        <div className="timeline-body" ref={scrubWrapperRef} onMouseDown={handleTimelineMouseDown}>
          {/* Header row */}
          <div className="timeline-header-row">
            <div className="timeline-layers-header">
              <span className="timeline-layers-title">Layers</span>
              <div className="timeline-layer-actions">
                <button
                  title={activeLayers.every((l) => l.visible) ? 'Hide all' : 'Show all'}
                  onClick={() => setAllLayersVisible(!activeLayers.every((l) => l.visible))}
                >
                  {activeLayers.every((l) => l.visible) ? '👁' : '👁‍🗨'}
                </button>
                <button
                  title={activeLayers.every((l) => l.locked) ? 'Unlock all' : 'Lock all'}
                  onClick={() => setAllLayersLocked(!activeLayers.every((l) => l.locked))}
                >
                  {activeLayers.every((l) => l.locked) ? '🔒' : '🔓'}
                </button>
              </div>
            </div>
            <div className="timeline-frame-numbers">
              {Array.from({ length: activeTotalFrames }, (_, i) => (
                <div
                  key={i}
                  className={`timeline-frame-number${(i + 1) % 5 === 0 ? ' fifth' : ''}`}
                >
                  {(i + 1) % 5 === 0 ? i + 1 : ''}
                </div>
              ))}
            </div>
          </div>
          {/* Layer rows */}
          {activeLayers.map((layer, layerIdx) => (
            <div key={layer.id}>
              {timelineLayerDrag && timelineLayerDropIdx === layerIdx && (
                <div className="timeline-layer-drop-indicator" />
              )}
              <div className="timeline-row">
              <div
                className={[
                  'timeline-layer',
                  selectedLayerIds.includes(layer.id) && 'active',
                  timelineLayerDrag && selectedLayerIds.includes(layer.id) && 'dragging',
                ].filter(Boolean).join(' ')}
                draggable
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.shiftKey) {
                    // Select range from active layer to this one
                    const s = useStore.getState()
                    const activeIdx = activeLayers.findIndex((l) => l.id === s.activeLayerId)
                    const minIdx = Math.min(activeIdx, layerIdx)
                    const maxIdx = Math.max(activeIdx, layerIdx)
                    setSelectedLayerIds(activeLayers.slice(minIdx, maxIdx + 1).map((l) => l.id))
                  } else if (e.ctrlKey || e.metaKey) {
                    useStore.getState().toggleSelectedLayerId(layer.id)
                  } else {
                    setSelectedLayerIds([layer.id])
                  }
                  setActiveLayerId(layer.id)
                  useStore.getState().setInspectorFocus('layer')
                }}
                onDragStart={(e) => {
                  if (!selectedLayerIds.includes(layer.id)) {
                    setSelectedLayerIds([layer.id])
                    setActiveLayerId(layer.id)
                  }
                  setTimelineLayerDrag(layer.id)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', layer.id)
                }}
                onDragEnd={() => { setTimelineLayerDrag(null); setTimelineLayerDropIdx(null) }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (timelineLayerDrag) {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    setTimelineLayerDropIdx(e.clientY < midY ? layerIdx : layerIdx + 1)
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (!timelineLayerDrag) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const midY = rect.top + rect.height / 2
                  const idx = e.clientY < midY ? layerIdx : layerIdx + 1
                  const s = useStore.getState()
                  if (s.selectedLayerIds.length > 1 && s.selectedLayerIds.includes(timelineLayerDrag)) {
                    s.reorderLayers(s.selectedLayerIds, idx)
                  } else {
                    reorderLayer(timelineLayerDrag, idx)
                  }
                  setTimelineLayerDrag(null)
                  setTimelineLayerDropIdx(null)
                }}
              >
                <span className="timeline-layer-icon">■</span>
                <span className="timeline-layer-name">{layer.name}</span>
                <div className="timeline-layer-actions">
                  <button
                    title="Toggle visibility"
                    style={{ opacity: layer.visible ? 1 : 0.3 }}
                    onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id) }}
                  >
                    👁
                  </button>
                  <button
                    title="Toggle lock"
                    onClick={(e) => { e.stopPropagation(); toggleLayerLocked(layer.id) }}
                  >
                    {layer.locked ? '🔒' : '🔓'}
                  </button>
                </div>
              </div>
              <div className="timeline-frame-row">
                {Array.from({ length: activeTotalFrames }, (_, i) => {
                  const frameNum = i + 1
                  const frameType = getFrameType(layer, frameNum)
                  const isSelected =
                    frameSelection?.layerIds.includes(layer.id) &&
                    frameNum >= (frameSelection?.startFrame ?? 0) &&
                    frameNum <= (frameSelection?.endFrame ?? 0)
                  const isInDragSelect = (() => {
                    const start = frameSelectStartRef.current
                    const end = frameSelectEnd
                    if (!start || !end) return false
                    const minF = Math.min(start.frame, end.frame)
                    const maxF = Math.max(start.frame, end.frame)
                    const minL = Math.min(start.layerIdx, end.layerIdx)
                    const maxL = Math.max(start.layerIdx, end.layerIdx)
                    return frameNum >= minF && frameNum <= maxF && layerIdx >= minL && layerIdx <= maxL
                  })()
                  const isKfDragSource = kfDrag?.layerId === layer.id && kfDrag.fromFrame === frameNum
                  const isKfDragTarget = kfDrag?.layerId === layer.id && kfDrag.toFrame === frameNum && kfDrag.fromFrame !== kfDrag.toFrame
                  return (
                    <div
                      key={i}
                      className={[
                        'timeline-frame-cell',
                        frameNum % 5 === 0 && 'fifth',
                        frameType,
                        frameNum === currentFrame && 'current',
                        (isSelected || isInDragSelect) && 'selected',
                        isKfDragSource && 'kf-drag-source',
                        isKfDragTarget && 'kf-drag-target',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    />
                  )
                })}
              </div>
              </div>
            </div>
          ))}
          {timelineLayerDrag && timelineLayerDropIdx === activeLayers.length && (
            <div className="timeline-layer-drop-indicator" />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
