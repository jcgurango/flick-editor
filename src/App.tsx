import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { Stage, Layer as KonvaLayer, Rect } from 'react-konva'
import type Konva from 'konva'
import { createProject, createLayer } from './types/project'
import type { Project } from './types/project'
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

function App() {
  const [project, _setProject] = useState<Project>(() => {
    const p = createProject('My Animation')
    p.layers.push(createLayer('Layer 2'))
    p.layers.push(createLayer('Background'))
    return p
  })
  const [currentFrame, setCurrentFrame] = useState(1)
  const [activeLayerId, setActiveLayerId] = useState(project.layers[0].id)

  // Canvas zoom/pan state
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Measure container and compute initial zoom-to-fit
  useLayoutEffect(() => {
    const el = canvasAreaRef.current
    if (!el) return

    const measure = () => {
      const { clientWidth, clientHeight } = el
      setStageSize({ width: clientWidth, height: clientHeight })

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
    // Only run on mount — we don't want resize to reset a user's zoom/pan
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mousewheel zoom (centered on pointer)
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()
      const stage = stageRef.current
      if (!stage) return

      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const direction = e.evt.deltaY < 0 ? 1 : -1
      const factor = direction > 0 ? ZOOM_SENSITIVITY : 1 / ZOOM_SENSITIVITY
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor))

      // Zoom toward pointer position
      const mouseX = pointer.x
      const mouseY = pointer.y
      const newPanX = mouseX - ((mouseX - pan.x) / zoom) * newZoom
      const newPanY = mouseY - ((mouseY - pan.y) / zoom) * newZoom

      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    },
    [zoom, pan],
  )

  // Shift+Drag pan
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!e.evt.shiftKey) return
      e.evt.preventDefault()
      isPanningRef.current = true
      panStartRef.current = {
        x: e.evt.clientX,
        y: e.evt.clientY,
        panX: pan.x,
        panY: pan.y,
      }
      // Change cursor
      const container = stageRef.current?.container()
      if (container) container.style.cursor = 'grabbing'
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanningRef.current) return
      const dx = e.evt.clientX - panStartRef.current.x
      const dy = e.evt.clientY - panStartRef.current.y
      setPan({
        x: panStartRef.current.panX + dx,
        y: panStartRef.current.panY + dy,
      })
    },
    [],
  )

  const handleMouseUp = useCallback(() => {
    if (!isPanningRef.current) return
    isPanningRef.current = false
    const container = stageRef.current?.container()
    if (container) container.style.cursor = ''
  }, [])

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
                className={`tool-btn${tool.id === 'select' ? ' active' : ''}`}
                title={tool.label}
              >
                {tool.icon}
              </button>
            )
          )}
        </div>

        {/* Canvas */}
        <div className="canvas-area" ref={canvasAreaRef}>
          {stageSize.width > 0 && (
            <Stage
              ref={stageRef}
              width={stageSize.width}
              height={stageSize.height}
              scaleX={zoom}
              scaleY={zoom}
              x={pan.x}
              y={pan.y}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              {/* Canvas background (the white "stage" rectangle) */}
              <KonvaLayer>
                <Rect
                  x={0}
                  y={0}
                  width={project.width}
                  height={project.height}
                  fill="#e8e8e8"
                  shadowColor="rgba(0,0,0,0.4)"
                  shadowBlur={20}
                  shadowOffsetY={4}
                />
              </KonvaLayer>
              {/* Content layers */}
              {project.layers
                .filter((l) => l.visible)
                .slice()
                .reverse()
                .map((layer) => (
                  <KonvaLayer key={layer.id}>
                    {/* Objects will be rendered here from keyframe data */}
                  </KonvaLayer>
                ))}
            </Stage>
          )}
        </div>

        {/* Inspector */}
        <div className="inspector">
          <div className="inspector-section">
            <div className="inspector-section-title">Properties</div>
            <div className="inspector-row">
              <span className="inspector-label">X</span>
              <input className="inspector-input" type="text" defaultValue="0" />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Y</span>
              <input className="inspector-input" type="text" defaultValue="0" />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">W</span>
              <input className="inspector-input" type="text" defaultValue="100" />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">H</span>
              <input className="inspector-input" type="text" defaultValue="100" />
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Fill</div>
            <div className="inspector-row">
              <span className="inspector-label">Color</span>
              <input className="inspector-input" type="text" defaultValue="#000000" />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Opacity</span>
              <input className="inspector-input" type="text" defaultValue="100%" />
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Stroke</div>
            <div className="inspector-row">
              <span className="inspector-label">Color</span>
              <input className="inspector-input" type="text" defaultValue="#000000" />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Width</span>
              <input className="inspector-input" type="text" defaultValue="1" />
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Scene</div>
            <div className="inspector-row">
              <span className="inspector-label">FPS</span>
              <input className="inspector-input" type="text" defaultValue={String(project.frameRate)} />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Width</span>
              <input className="inspector-input" type="text" defaultValue={String(project.width)} />
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Height</span>
              <input className="inspector-input" type="text" defaultValue={String(project.height)} />
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="timeline">
        <div className="timeline-toolbar">
          <button className="timeline-btn" title="Add Layer">+</button>
          <button className="timeline-btn" title="Delete Layer">−</button>
          <div style={{ flex: 1 }} />
          <button className="timeline-btn" title="Previous Frame">⏮</button>
          <button className="timeline-btn" title="Play">▶</button>
          <button className="timeline-btn" title="Next Frame">⏭</button>
          <div style={{ flex: 1 }} />
          <button className="timeline-btn" title="Add Keyframe">◆</button>
        </div>

        <div className="timeline-body">
          {/* Layers list */}
          <div className="timeline-layers">
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
          <div className="timeline-frames-wrapper">
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
              {project.layers.map((layer) => {
                const keyframeFrames = new Set(layer.keyframes.map((kf) => kf.frame))
                return (
                  <div key={layer.id} className="timeline-frame-row">
                    {Array.from({ length: FRAME_COUNT }, (_, i) => (
                      <div
                        key={i}
                        className={`timeline-frame-cell${(i + 1) % 5 === 0 ? ' fifth' : ''}${keyframeFrames.has(i + 1) ? ' has-content' : ''}${i + 1 === currentFrame ? ' current' : ''}`}
                        onClick={() => setCurrentFrame(i + 1)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
