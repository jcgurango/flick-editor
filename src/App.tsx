import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { useStore } from './store'
import { getActiveKeyframe, getNextKeyframe, generateId, getSingleSelectedKeyframe, createProject } from './types/project'
import type { Layer } from './types/project'
import { resolveFrame } from './lib/interpolate'
import { dragAttrs, computeScale, computeRotationAttrs } from './lib/transform'
import { computeBBox, absoluteOrigin, rotatedCorners } from './lib/bbox'
import type { BBox } from './lib/bbox'
import type { HandleId, RotateCorner } from './components/BoundingBox'
import type { FlickObject } from './types/project'
import { SvgObject } from './components/SvgObject'
import { BoundingBox } from './components/BoundingBox'
import { Inspector } from './components/Inspector'
import { Hierarchy } from './components/Hierarchy'
import { MenuBar } from './components/MenuBar'
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

      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const s = useStore.getState()
        if (s.inspectorFocus === 'canvas' && s.selectedObjectIds.length > 0) {
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

      // Arrow key nudge
      const s = useStore.getState()
      if (s.selectedObjectIds.length > 0 && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0

        for (const objId of s.selectedObjectIds) {
          // Find which layer contains this object on the current keyframe
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
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [togglePlayback])

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
        // Total delta from drag start (not incremental)
        const dx = (e.clientX - dragStartRef.current.x) / s.zoom
        const dy = (e.clientY - dragStartRef.current.y) / s.zoom
        const { id, type, attrs } = dragObjRef.current
        const newAttrs = dragAttrs(type, attrs, dx, dy)
        // Don't commit — store as preview
        setDragPreview({ id, type, attrs: { ...attrs, ...newAttrs } })
        return
      }

      if (isScalingRef.current && scaleObjRef.current) {
        const s = useStore.getState()
        // Total delta from drag start (not incremental)
        const dx = (e.clientX - scaleStartRef.current.x) / s.zoom
        const dy = (e.clientY - scaleStartRef.current.y) / s.zoom
        const { id, type, attrs } = scaleObjRef.current
        const bbox = computeBBox({ id, type, attrs })
        if (!bbox) return
        const rotation = (attrs.rotation as number) ?? 0
        const newAttrs = computeScale(
          type, attrs, bbox, scaleHandleRef.current,
          dx, dy, rotation, e.shiftKey, e.ctrlKey,
        )
        // Don't commit — store as preview
        setScalePreview({ id, type, attrs: { ...attrs, ...newAttrs } })
        return
      }

      if (isRotatingRef.current && rotateObjRef.current) {
        const s = useStore.getState()
        const rect = e.currentTarget.getBoundingClientRect()
        const canvasX = (e.clientX - rect.left - s.pan.x) / s.zoom
        const canvasY = (e.clientY - rect.top - s.pan.y) / s.zoom

        const { id, type, attrs } = rotateObjRef.current

        // Live pivot switching when shift toggles
        if (e.shiftKey !== rotateLastShiftRef.current) {
          const [opx, opy] = rotatePivotRef.current
          const oldAngle = Math.atan2(canvasY - opy, canvasX - opx)
          const oldDelta = oldAngle - rotateRefAngleRef.current

          const bbox = computeBBox({ id, type, attrs })
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
            const newAngle = Math.atan2(canvasY - newPivot[1], canvasX - newPivot[0])
            rotateRefAngleRef.current = newAngle - oldDelta
            rotatePivotRef.current = newPivot
          }
          rotateLastShiftRef.current = e.shiftKey
        }

        const [px, py] = rotatePivotRef.current
        const currentAngle = Math.atan2(canvasY - py, canvasX - px)
        const rawDeltaDeg = ((currentAngle - rotateRefAngleRef.current) * 180) / Math.PI
        let newRotation = rotateOrigRotRef.current + rawDeltaDeg

        // Normalize to 0-360
        newRotation = ((newRotation % 360) + 360) % 360

        // Snap to 15 degree increments unless ctrl is held
        if (!e.ctrlKey) {
          newRotation = Math.round(newRotation / 15) * 15
        }

        const bbox = computeBBox({ id, type, attrs })
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
    [setPan],
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
        s.updateObjectAttrs(layerId, s.currentFrame, dragPreview.id, changed)
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
        for (const layer of s.project.layers) {
          if (!layer.visible || layer.locked) continue
          if (!layer.keyframes.some((kf) => kf.frame === s.currentFrame)) continue
          const objects = resolveFrame(layer, s.currentFrame)
          for (const obj of objects) {
            const bbox = computeBBox(obj)
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
      // Merge only the changed attrs (preview has full attrs, diff against original)
      const original = scaleObjRef.current.attrs
      const changed: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(scalePreview.attrs)) {
        if (v !== original[k]) changed[k] = v
      }
      if (Object.keys(changed).length > 0) {
        s.updateObjectAttrs(layerId, s.currentFrame, scalePreview.id, changed)
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
        s.updateObjectAttrs(layerId, s.currentFrame, rotatePreview.id, changed)
      }
    }
    isRotatingRef.current = false
    rotateObjRef.current = null
    setRotatePreview(null)

    // Commit drawn shape
    if (isDrawingRef.current && drawPreview) {
      const s = useStore.getState()
      const layer = s.project.layers.find((l) => l.id === s.activeLayerId)
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

  /** Compute frame number from mouse X on the unified timeline body (accounting for sticky layer column). */
  const frameFromX = useCallback(
    (ev: MouseEvent | React.MouseEvent) => {
      const wrapper = scrubWrapperRef.current
      if (!wrapper) return null
      const rect = wrapper.getBoundingClientRect()
      const x = ev.clientX - rect.left + wrapper.scrollLeft - 160 // layer column width
      if (x < 0) return null // clicked on layer column
      return Math.max(1, Math.min(project.totalFrames, Math.floor(x / 16) + 1))
    },
    [project.totalFrames],
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
      const layerIdx = Math.max(0, Math.min(project.layers.length - 1, Math.floor(y / 28)))
      return { layerIdx, frame }
    },
    [project.layers.length, frameFromX],
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

      // Clear previous selection immediately
      setFrameSelection(null)

      isFrameSelectingRef.current = true
      frameSelectStartRef.current = cell
      frameSelectShiftRef.current = e.shiftKey
      setFrameSelectEnd(cell)

      // Move playhead immediately (unless shift)
      if (!e.shiftKey) {
        setCurrentFrame(cell.frame)
        setActiveLayerId(project.layers[cell.layerIdx].id)
      }

      const onMove = (ev: MouseEvent) => {
        if (!isFrameSelectingRef.current) return
        const end = cellFromEvent(ev)
        if (end) setFrameSelectEnd(end)
      }
      const onUp = () => {
        isFrameSelectingRef.current = false
        const start = frameSelectStartRef.current
        const end = frameSelectEndRef.current
        if (start && end) {
          const minFrame = Math.min(start.frame, end.frame)
          const maxFrame = Math.max(start.frame, end.frame)
          const minLayer = Math.min(start.layerIdx, end.layerIdx)
          const maxLayer = Math.max(start.layerIdx, end.layerIdx)
          const layers = useStore.getState().project.layers
          const layerIds = layers.slice(minLayer, maxLayer + 1).map(l => l.id)
          useStore.getState().setFrameSelection({ layerIds, startFrame: minFrame, endFrame: maxFrame })
          useStore.getState().setInspectorFocus('timeline')
          if (!frameSelectShiftRef.current) {
            useStore.getState().setCurrentFrame(minFrame)
            useStore.getState().setActiveLayerId(layerIds[0])
          }
        }
        setFrameSelectEnd(null)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [cellFromEvent, frameFromX, setCurrentFrame, setActiveLayerId, setFrameSelection, project.layers],
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
        <div className="canvas-area" ref={canvasAreaRef}>
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
                <clipPath id="canvas-clip">
                  <rect x={0} y={0} width={project.width} height={project.height} />
                </clipPath>
              </defs>

              <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                <rect
                  x={0}
                  y={0}
                  width={project.width}
                  height={project.height}
                  fill="#e8e8e8"
                  filter="url(#canvas-shadow)"
                  pointerEvents="all"
                />

                <g clipPath="url(#canvas-clip)" pointerEvents={activeTool === 'select' ? undefined : 'none'}>
                  {project.layers
                    .filter((l) => l.visible)
                    .slice()
                    .reverse()
                    .map((layer) => {
                      const objects = resolveFrame(layer, currentFrame)
                      const isOnKeyframe = layer.keyframes.some((kf) => kf.frame === currentFrame)
                      return (
                        <g key={layer.id} data-layer-id={layer.id}>
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
                              onMouseDown={activeTool === 'select' ? (e) => {
                                if (e.button !== 0) return
                                if (!isOnKeyframe || layer.locked || e.shiftKey) return
                                if (e.ctrlKey || e.metaKey) return // ctrl-click handled in onClick
                                // Find the keyframe object (not interpolated) for editing
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
                      )
                    })}
                </g>

                {/* Drag preview ghost */}
                {dragPreview && (
                  <g opacity={0.4}>
                    <SvgObject obj={dragPreview} />
                  </g>
                )}

                {/* Scale preview ghost */}
                {scalePreview && (
                  <g opacity={0.4}>
                    <SvgObject obj={scalePreview} />
                  </g>
                )}

                {/* Rotation preview ghost */}
                {rotatePreview && (
                  <g opacity={0.4}>
                    <SvgObject obj={rotatePreview} />
                  </g>
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
                  const allObjects = project.layers
                    .filter((l) => l.visible)
                    .flatMap((l) => resolveFrame(l, currentFrame))
                  const singleSelected = selectedObjectIds.length === 1

                  return selectedObjectIds.map((selId) => {
                    // During drag/scale/rotate, show bbox around preview
                    const selObj = (dragPreview && dragPreview.id === selId)
                      ? dragPreview
                      : (scalePreview && scalePreview.id === selId)
                        ? scalePreview
                        : (rotatePreview && rotatePreview.id === selId)
                          ? rotatePreview
                          : allObjects.find((o) => o.id === selId)
                    if (!selObj) return null
                    return (
                      <BoundingBox
                        key={selId}
                        obj={selObj}
                        zoom={zoom}
                        onHandleMouseDown={singleSelected ? (handle, e) => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          const layer = project.layers.find((l) => l.id === activeLayerId)
                          const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                          const kfObj = kf?.objects.find((o) => o.id === selId)
                          if (!layer || !kf || !kfObj) return
                          isScalingRef.current = true
                          scaleStartRef.current = { x: e.clientX, y: e.clientY }
                          scaleHandleRef.current = handle
                          scaleObjRef.current = { id: kfObj.id, layerId: layer.id, type: kfObj.type, attrs: { ...kfObj.attrs } }
                        } : undefined}
                        onRotateMouseDown={singleSelected ? (corner: RotateCorner, e: React.MouseEvent) => {
                          if (e.button !== 0) return
                          e.stopPropagation()
                          const layer = project.layers.find((l) => l.id === activeLayerId)
                          const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                          const kfObj = kf?.objects.find((o) => o.id === selId)
                          if (!layer || !kf || !kfObj) return

                          const bbox = computeBBox(kfObj)
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
                          const startX = (e.clientX - svgRect.left - s.pan.x) / s.zoom
                          const startY = (e.clientY - svgRect.top - s.pan.y) / s.zoom

                          isRotatingRef.current = true
                          rotateRefAngleRef.current = Math.atan2(startY - pivot[1], startX - pivot[0])
                          rotatePivotRef.current = pivot
                          rotateOrigRotRef.current = rot
                          rotateLastShiftRef.current = e.shiftKey
                          rotateCornerRef.current = corner
                          rotateObjRef.current = { id: kfObj.id, layerId: layer.id, type: kfObj.type, attrs: { ...kfObj.attrs } }
                        } : undefined}
                      />
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
            <Inspector />
          </div>
          <Hierarchy />
        </div>
      </div>

      {/* Timeline resize handle */}
      <div className="resize-handle-h" onMouseDown={handleTimelineResize} />

      {/* Timeline */}
      <div className="timeline" style={{ height: timelineHeight }}>
        <div className="timeline-toolbar">
          <button className="timeline-btn" title="Add Layer" onClick={() => useStore.getState().addLayer()}>+</button>
          <button className="timeline-btn" title="Delete Layer" onClick={() => useStore.getState().deleteSelectedLayers()}>−</button>
          <div style={{ flex: 1 }} />
          <button className="timeline-btn" title="Previous Frame" onClick={() => setCurrentFrame(Math.max(1, currentFrame - 1))}>⏮</button>
          <button className="timeline-btn" title={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="timeline-btn" title="Next Frame" onClick={() => setCurrentFrame(Math.min(project.totalFrames, currentFrame + 1))}>⏭</button>
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
                  title={project.layers.every((l) => l.visible) ? 'Hide all' : 'Show all'}
                  onClick={() => setAllLayersVisible(!project.layers.every((l) => l.visible))}
                >
                  {project.layers.every((l) => l.visible) ? '👁' : '👁‍🗨'}
                </button>
                <button
                  title={project.layers.every((l) => l.locked) ? 'Unlock all' : 'Lock all'}
                  onClick={() => setAllLayersLocked(!project.layers.every((l) => l.locked))}
                >
                  {project.layers.every((l) => l.locked) ? '🔒' : '🔓'}
                </button>
              </div>
            </div>
            <div className="timeline-frame-numbers">
              {Array.from({ length: project.totalFrames }, (_, i) => (
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
          {project.layers.map((layer, layerIdx) => (
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
                    const activeIdx = project.layers.findIndex((l) => l.id === s.activeLayerId)
                    const minIdx = Math.min(activeIdx, layerIdx)
                    const maxIdx = Math.max(activeIdx, layerIdx)
                    setSelectedLayerIds(project.layers.slice(minIdx, maxIdx + 1).map((l) => l.id))
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
                {Array.from({ length: project.totalFrames }, (_, i) => {
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
                  return (
                    <div
                      key={i}
                      className={[
                        'timeline-frame-cell',
                        frameNum % 5 === 0 && 'fifth',
                        frameType,
                        frameNum === currentFrame && 'current',
                        (isSelected || isInDragSelect) && 'selected',
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
          {timelineLayerDrag && timelineLayerDropIdx === project.layers.length && (
            <div className="timeline-layer-drop-indicator" />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
