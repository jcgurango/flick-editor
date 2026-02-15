import { useState, useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { useStore } from './store'
import { getActiveKeyframe, getNextKeyframe, generateId } from './types/project'
import type { Layer } from './types/project'
import { resolveFrame } from './lib/interpolate'
import { dragAttrs, computeScale, computeRotationAttrs } from './lib/transform'
import { computeBBox, absoluteOrigin, rotatedCorners } from './lib/bbox'
import type { HandleId, RotateCorner } from './components/BoundingBox'
import type { FlickObject } from './types/project'
import { SvgObject } from './components/SvgObject'
import { BoundingBox } from './components/BoundingBox'
import { Inspector } from './components/Inspector'
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

const FRAME_COUNT = 60

/**
 * Determine the display type of a frame cell in the timeline.
 */
function getFrameType(layer: Layer, frame: number): 'keyframe' | 'tweened' | 'held' | 'empty' {
  for (const kf of layer.keyframes) {
    if (kf.frame === frame) return 'keyframe'
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
  const selectedKeyframe = useStore((s) => s.selectedKeyframe)
  const setSelectedKeyframe = useStore((s) => s.setSelectedKeyframe)
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
  const selectedObjectId = useStore((s) => s.selectedObjectId)
  const setSelectedObjectId = useStore((s) => s.setSelectedObjectId)
  // Scale preview: a ghost object shown during scaling (not yet committed)
  const [scalePreview, setScalePreview] = useState<FlickObject | null>(null)
  // Draw preview: shape being drawn with rect/ellipse tool
  const [drawPreview, setDrawPreview] = useState<FlickObject | null>(null)

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

      // Arrow key nudge
      const s = useStore.getState()
      if (s.selectedObjectId && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault()
        const dx = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
        const dy = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0

        // Find the object's layer and keyframe
        const layer = s.project.layers.find((l) => l.id === s.activeLayerId)
        const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
        const obj = kf?.objects.find((o) => o.id === s.selectedObjectId)
        if (layer && kf && obj) {
          const newAttrs = dragAttrs(obj.type, obj.attrs, dx, dy)
          s.updateObjectAttrs(layer.id, kf.frame, obj.id, newAttrs)
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

  // Timeline scrub
  const isScrubbing = useRef(false)
  const scrubWrapperRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<HTMLDivElement>(null)

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
      const s = useStore.getState()

      if (s.activeTool === 'select' && e.shiftKey) {
        e.preventDefault()
        isPanningRef.current = true
        panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
        canvasAreaRef.current!.style.cursor = 'grabbing'
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
        const dx = (e.clientX - dragStartRef.current.x) / s.zoom
        const dy = (e.clientY - dragStartRef.current.y) / s.zoom
        const { id, layerId, type, attrs } = dragObjRef.current
        const newAttrs = dragAttrs(type, attrs, dx, dy)
        s.updateObjectAttrs(layerId, s.currentFrame, id, newAttrs)
        dragStartRef.current = { x: e.clientX, y: e.clientY }
        dragObjRef.current = { ...dragObjRef.current, attrs: { ...attrs, ...newAttrs } }
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

        const { id, layerId, type, attrs } = rotateObjRef.current

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
        s.updateObjectAttrs(layerId, s.currentFrame, id, rotAttrs)
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

  const handleMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false
      canvasAreaRef.current!.style.cursor = ''
    }
    isDraggingRef.current = false
    dragObjRef.current = null

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
    isRotatingRef.current = false
    rotateObjRef.current = null

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
          s.setSelectedObjectId(drawPreview.id)
        }
      }
    }
    isDrawingRef.current = false
    setDrawPreview(null)
  }, [scalePreview, drawPreview])

  // Timeline scrubbing
  const scrubToX = useCallback(
    (clientX: number) => {
      const wrapper = scrubWrapperRef.current
      if (!wrapper) return
      const rect = wrapper.getBoundingClientRect()
      const x = clientX - rect.left + wrapper.scrollLeft
      const frame = Math.max(1, Math.min(FRAME_COUNT, Math.floor(x / 16) + 1))
      setCurrentFrame(frame)
    },
    [setCurrentFrame],
  )

  const handleScrubDown = useCallback(
    (e: React.MouseEvent) => {
      isScrubbing.current = true
      setSelectedKeyframe(null)
      scrubToX(e.clientX)

      const onMove = (ev: MouseEvent) => {
        if (!isScrubbing.current) return
        scrubToX(ev.clientX)
      }
      const onUp = () => {
        isScrubbing.current = false
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [scrubToX, setSelectedKeyframe],
  )

  // Keyframe cell click — select keyframe if it's a keyframe cell
  const handleCellClick = useCallback(
    (layerId: string, frame: number, isKeyframe: boolean, e: React.MouseEvent) => {
      e.stopPropagation()
      if (isKeyframe) {
        setSelectedKeyframe({ layerId, frame })
        setCurrentFrame(frame)
      } else {
        setSelectedKeyframe(null)
        setCurrentFrame(frame)
      }
    },
    [setSelectedKeyframe, setCurrentFrame],
  )

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <span className="header-logo">FLICK</span>
        <div className="header-menu">
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
          <span>Insert</span>
          <span>Modify</span>
          <span>Control</span>
          <span>Help</span>
        </div>
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
                  onClick={() => { if (activeTool === 'select') setSelectedObjectId(null) }}
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
                                if (!isOnKeyframe) return
                                e.stopPropagation()
                                setSelectedObjectId(obj.id)
                                setActiveLayerId(layer.id)
                                setSelectedKeyframe(null)
                              } : undefined}
                              onMouseDown={activeTool === 'select' ? (e) => {
                                if (!isOnKeyframe || e.shiftKey) return
                                // Find the keyframe object (not interpolated) for editing
                                const kf = layer.keyframes.find((k) => k.frame === currentFrame)
                                const kfObj = kf?.objects.find((o) => o.id === obj.id)
                                if (!kfObj) return
                                e.stopPropagation()
                                isDraggingRef.current = true
                                dragStartRef.current = { x: e.clientX, y: e.clientY }
                                dragObjRef.current = { id: obj.id, layerId: layer.id, type: kfObj.type, attrs: { ...kfObj.attrs } }
                                setSelectedObjectId(obj.id)
                                setActiveLayerId(layer.id)
                                setSelectedKeyframe(null)
                              } : undefined}
                            />
                          ))}
                        </g>
                      )
                    })}
                </g>

                {/* Scale preview ghost */}
                {scalePreview && (
                  <g opacity={0.4}>
                    <SvgObject obj={scalePreview} />
                  </g>
                )}

                {/* Draw preview ghost */}
                {drawPreview && (
                  <g opacity={0.6}>
                    <SvgObject obj={drawPreview} />
                  </g>
                )}

                {/* Bounding box for selected object */}
                {activeTool === 'select' && selectedObjectId && (() => {
                  // During scaling, show bbox around preview; otherwise around actual object
                  const selObj = scalePreview ?? project.layers
                    .filter((l) => l.visible)
                    .flatMap((l) => resolveFrame(l, currentFrame))
                    .find((o) => o.id === selectedObjectId)
                  if (!selObj) return null
                  return (
                    <BoundingBox
                      obj={selObj}
                      zoom={zoom}
                      onHandleMouseDown={(handle, e) => {
                        e.stopPropagation()
                        const layer = project.layers.find((l) => l.id === activeLayerId)
                        const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                        const kfObj = kf?.objects.find((o) => o.id === selectedObjectId)
                        if (!layer || !kf || !kfObj) return
                        isScalingRef.current = true
                        scaleStartRef.current = { x: e.clientX, y: e.clientY }
                        scaleHandleRef.current = handle
                        scaleObjRef.current = { id: kfObj.id, layerId: layer.id, type: kfObj.type, attrs: { ...kfObj.attrs } }
                      }}
                      onRotateMouseDown={(corner: RotateCorner, e: React.MouseEvent) => {
                        e.stopPropagation()
                        const layer = project.layers.find((l) => l.id === activeLayerId)
                        const kf = layer?.keyframes.find((k) => k.frame === currentFrame)
                        const kfObj = kf?.objects.find((o) => o.id === selectedObjectId)
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
                      }}
                    />
                  )
                })()}
              </g>
            </svg>
          )}
        </div>

        {/* Inspector */}
        <Inspector />
      </div>

      {/* Timeline */}
      <div className="timeline">
        <div className="timeline-toolbar">
          <button className="timeline-btn" title="Add Layer">+</button>
          <button className="timeline-btn" title="Delete Layer">−</button>
          <div style={{ flex: 1 }} />
          <button className="timeline-btn" title="Previous Frame">⏮</button>
          <button className="timeline-btn" title={isPlaying ? 'Pause' : 'Play'} onClick={togglePlayback}>
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="timeline-btn" title="Next Frame">⏭</button>
          <div style={{ flex: 1 }} />
          <span className="timeline-frame-display">Frame {currentFrame}</span>
          <button className="timeline-btn" title="Add Keyframe">◆</button>
        </div>

        <div className="timeline-body">
          {/* Layers list */}
          <div className="timeline-layers" ref={layersRef}>
            {project.layers.map((layer) => (
              <div
                key={layer.id}
                className={`timeline-layer${layer.id === activeLayerId ? ' active' : ''}`}
                onClick={() => setActiveLayerId(layer.id)}
              >
                <span className="timeline-layer-icon">■</span>
                <span className="timeline-layer-name">{layer.name}</span>
                <div className="timeline-layer-actions">
                  <button title="Toggle visibility">👁</button>
                  <button title="Lock layer">🔒</button>
                </div>
              </div>
            ))}
          </div>

          {/* Frames grid */}
          <div
            className="timeline-frames-wrapper"
            ref={scrubWrapperRef}
            onMouseDown={handleScrubDown}
            onScroll={(e) => {
              if (layersRef.current) {
                layersRef.current.scrollTop = e.currentTarget.scrollTop
              }
            }}
          >
            {/* Playhead line */}
            <div
              className="timeline-playhead"
              style={{ left: (currentFrame - 1) * 16 + 8 }}
            />

            <div className="timeline-frame-numbers">
              {Array.from({ length: FRAME_COUNT }, (_, i) => (
                <div
                  key={i}
                  className={`timeline-frame-number${(i + 1) % 5 === 0 ? ' fifth' : ''}`}
                >
                  {(i + 1) % 5 === 0 ? i + 1 : ''}
                </div>
              ))}
            </div>
            <div className="timeline-frames-rows">
              {project.layers.map((layer) => (
                <div key={layer.id} className="timeline-frame-row">
                  {Array.from({ length: FRAME_COUNT }, (_, i) => {
                    const frameNum = i + 1
                    const frameType = getFrameType(layer, frameNum)
                    const isKf = frameType === 'keyframe'
                    const isSelected =
                      isKf &&
                      selectedKeyframe?.layerId === layer.id &&
                      selectedKeyframe?.frame === frameNum
                    return (
                      <div
                        key={i}
                        className={[
                          'timeline-frame-cell',
                          frameNum % 5 === 0 && 'fifth',
                          frameType,
                          frameNum === currentFrame && 'current',
                          isSelected && 'selected',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={(e) => handleCellClick(layer.id, frameNum, isKf, e)}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
