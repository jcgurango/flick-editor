import { useRef, useCallback, useLayoutEffect, useEffect } from 'react'
import { useStore } from './store'
import { getActiveKeyframe, getNextKeyframe } from './types/project'
import type { Layer } from './types/project'
import { resolveFrame } from './lib/interpolate'
import { SvgObject } from './components/SvgObject'
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

  // Space key shortcut for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        // Don't trigger if user is typing in an input
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        e.preventDefault()
        togglePlayback()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [togglePlayback])

  // Canvas refs
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  // Timeline scrub
  const isScrubbing = useRef(false)
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

  // Shift+Drag pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!e.shiftKey) return
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      canvasAreaRef.current!.style.cursor = 'grabbing'
    },
    [pan],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isPanningRef.current) return
      setPan({
        x: panStartRef.current.panX + e.clientX - panStartRef.current.x,
        y: panStartRef.current.panY + e.clientY - panStartRef.current.y,
      })
    },
    [setPan],
  )

  const handleMouseUp = useCallback(() => {
    if (!isPanningRef.current) return
    isPanningRef.current = false
    canvasAreaRef.current!.style.cursor = ''
  }, [])

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
                <rect
                  x={0}
                  y={0}
                  width={project.width}
                  height={project.height}
                  fill="#e8e8e8"
                  filter="url(#canvas-shadow)"
                />

                <g clipPath="url(#canvas-clip)">
                  {project.layers
                    .filter((l) => l.visible)
                    .slice()
                    .reverse()
                    .map((layer) => {
                      const objects = resolveFrame(layer, currentFrame)
                      return (
                        <g key={layer.id} data-layer-id={layer.id}>
                          {objects.map((obj) => (
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
