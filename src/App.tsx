import { useState, useRef, useCallback, useLayoutEffect } from 'react'
import { createProject, createLayer, getActiveKeyframe, generateId } from './types/project'
import type { Project, Layer } from './types/project'
import { SvgObject } from './components/SvgObject'
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

/** Build a demo project with test keyframe data. */
function createDemoProject(): Project {
  const p = createProject('My Animation')
  const rectId = generateId()

  // Layer 1: a rect that moves and resizes between frame 1 and frame 15
  p.layers[0].keyframes = [
    {
      frame: 1,
      objects: [
        {
          id: rectId,
          type: 'rect',
          attrs: { x: 200, y: 200, width: 200, height: 150, fill: '#4a7aff', stroke: '#2255cc', strokeWidth: 2, rx: 4 },
        },
      ],
    },
    {
      frame: 15,
      objects: [
        {
          id: rectId,
          type: 'rect',
          attrs: { x: 800, y: 400, width: 400, height: 250, fill: '#ff6a4a', stroke: '#cc3322', strokeWidth: 2, rx: 4 },
        },
      ],
    },
  ]

  // Layer 2: a circle sitting still
  const layer2 = createLayer('Layer 2')
  const circleId = generateId()
  layer2.keyframes = [
    {
      frame: 1,
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

  // Background layer: empty
  p.layers.push(createLayer('Background'))

  return p
}

/**
 * For a given layer & frame number, determine the "span" type of that frame:
 * - 'keyframe': this frame has a keyframe
 * - 'held': this frame is between two keyframes (or after the last keyframe), content is held
 * - 'empty': before the first keyframe
 */
function getFrameType(layer: Layer, frame: number): 'keyframe' | 'held' | 'empty' {
  for (const kf of layer.keyframes) {
    if (kf.frame === frame) return 'keyframe'
  }
  const active = getActiveKeyframe(layer, frame)
  return active ? 'held' : 'empty'
}

function App() {
  const [project, _setProject] = useState<Project>(createDemoProject)
  const [currentFrame, setCurrentFrame] = useState(1)
  const [activeLayerId, setActiveLayerId] = useState(project.layers[0].id)

  // Canvas zoom/pan state
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Timeline scrub state
  const isScrubbing = useRef(false)

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

  // Mousewheel zoom (centered on pointer)
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
    [zoom, pan],
  )

  // Shift+Drag pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!e.shiftKey) return
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
      canvasAreaRef.current!.style.cursor = 'grabbing'
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isPanningRef.current) return
      const dx = e.clientX - panStartRef.current.x
      const dy = e.clientY - panStartRef.current.y
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
    canvasAreaRef.current!.style.cursor = ''
  }, [])

  // Timeline scrubbing: track the wrapper element so document-level handlers can use it
  const scrubWrapperRef = useRef<HTMLDivElement>(null)

  const scrubToX = useCallback((clientX: number) => {
    const wrapper = scrubWrapperRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const x = clientX - rect.left + wrapper.scrollLeft
    const frame = Math.max(1, Math.min(FRAME_COUNT, Math.floor(x / 16) + 1))
    setCurrentFrame(frame)
  }, [])

  const handleScrubDown = useCallback((e: React.MouseEvent) => {
    isScrubbing.current = true
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
  }, [scrubToX])

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
          {containerSize.width > 0 && (
            <svg
              width={containerSize.width}
              height={containerSize.height}
              className="canvas-svg"
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
                {/* Canvas background */}
                <rect
                  x={0}
                  y={0}
                  width={project.width}
                  height={project.height}
                  fill="#e8e8e8"
                  filter="url(#canvas-shadow)"
                />

                {/* Content layers (reversed so first layer renders on top) */}
                <g clipPath="url(#canvas-clip)">
                  {project.layers
                    .filter((l) => l.visible)
                    .slice()
                    .reverse()
                    .map((layer) => {
                      const kf = getActiveKeyframe(layer, currentFrame)
                      return (
                        <g key={layer.id} data-layer-id={layer.id}>
                          {kf?.objects.map((obj) => (
                            <SvgObject key={obj.id} obj={obj} />
                          ))}
                        </g>
                      )
                    })}
                </g>
              </g>
            </svg>
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
          <span className="timeline-frame-display">Frame {currentFrame}</span>
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
          <div
            className="timeline-frames-wrapper"
            ref={scrubWrapperRef}
            onMouseDown={handleScrubDown}
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
                    return (
                      <div
                        key={i}
                        className={[
                          'timeline-frame-cell',
                          (frameNum) % 5 === 0 && 'fifth',
                          frameType === 'keyframe' && 'keyframe',
                          frameType === 'held' && 'held',
                          frameNum === currentFrame && 'current',
                        ].filter(Boolean).join(' ')}
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
