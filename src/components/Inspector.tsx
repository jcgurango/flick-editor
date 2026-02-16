import { useState } from 'react'
import { useStore } from '../store'
import type { TweenType, EaseDirection } from '../types/project'
import { OBJECT_FIELDS, TYPE_NAMES } from '../lib/inspector-schema'
import { InspectorField } from './InspectorField'
import './Inspector.css'

const TWEEN_TYPES: { value: TweenType; label: string }[] = [
  { value: 'discrete', label: 'Discrete' },
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'cubic', label: 'Cubic' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'circular', label: 'Circular' },
  { value: 'elastic', label: 'Elastic' },
  { value: 'bounce', label: 'Bounce' },
]

const EASE_DIRS: { value: EaseDirection; label: string }[] = [
  { value: 'in', label: 'Ease In' },
  { value: 'out', label: 'Ease Out' },
  { value: 'in-out', label: 'Ease In-Out' },
]

function TweenSection({ layerId, kf }: { layerId: string; kf: { frame: number; tween: TweenType; easeDirection: EaseDirection } }) {
  const setKeyframeTween = useStore((s) => s.setKeyframeTween)
  const setKeyframeEaseDirection = useStore((s) => s.setKeyframeEaseDirection)

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Tween</div>
      <div className="inspector-row">
        <span className="inspector-label">Type</span>
        <select
          className="inspector-select"
          value={kf.tween}
          onChange={(e) => setKeyframeTween(layerId, kf.frame, e.target.value as TweenType)}
        >
          {TWEEN_TYPES.map((tt) => (
            <option key={tt.value} value={tt.value}>{tt.label}</option>
          ))}
        </select>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Easing</span>
        <select
          className="inspector-select"
          value={kf.easeDirection}
          disabled={kf.tween === 'discrete'}
          onChange={(e) => setKeyframeEaseDirection(layerId, kf.frame, e.target.value as EaseDirection)}
        >
          {EASE_DIRS.map((ed) => (
            <option key={ed.value} value={ed.value}>{ed.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

export function Inspector() {
  const project = useStore((s) => s.project)
  const selectedKeyframe = useStore((s) => s.selectedKeyframe)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const currentFrame = useStore((s) => s.currentFrame)
  const updateObjectAttrs = useStore((s) => s.updateObjectAttrs)
  const inspectorFocus = useStore((s) => s.inspectorFocus)

  // Find selected object on the active keyframe
  const activeLayer = project.layers.find((l) => l.id === activeLayerId)
  const activeKf = activeLayer?.keyframes.find((k) => k.frame === currentFrame)
  const selectedObj = selectedObjectIds.length === 1 && activeKf
    ? activeKf.objects.find((o) => o.id === selectedObjectIds[0])
    : null

  // Resolve keyframe data for timeline selection
  const selectedKfData = selectedKeyframe
    ? (() => {
        const layer = project.layers.find((l) => l.id === selectedKeyframe.layerId)
        const kf = layer?.keyframes.find((k) => k.frame === selectedKeyframe.frame)
        return kf ? { layer: layer!, kf } : null
      })()
    : null

  // Canvas focus: show object properties
  if (inspectorFocus === 'canvas') {
    // Multi-select
    if (selectedObjectIds.length > 1 && activeLayer && activeKf) {
      return (
        <div className="inspector">
          <div className="inspector-section">
            <div className="inspector-section-title">Selection</div>
            <div className="inspector-section-subtitle">
              {selectedObjectIds.length} objects selected
            </div>
          </div>
          <TweenSection layerId={activeLayer.id} kf={activeKf} />
        </div>
      )
    }

    // Single object selected
    if (selectedObj && activeLayer && activeKf) {
      const fields = OBJECT_FIELDS[selectedObj.type] ?? []
      const typeName = TYPE_NAMES[selectedObj.type] ?? selectedObj.type

      return (
        <div className="inspector">
          <div className="inspector-section">
            <div className="inspector-section-title">{typeName}</div>
            <div className="inspector-section-subtitle">
              {selectedObj.id.slice(-8)}
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Properties</div>
            {fields.map((field) => (
              <InspectorField
                key={field.key}
                field={field}
                value={selectedObj.attrs[field.key]}
                onChange={(val) =>
                  updateObjectAttrs(activeLayer.id, activeKf.frame, selectedObj.id, { [field.key]: val })
                }
              />
            ))}
          </div>

          <TweenSection layerId={activeLayer.id} kf={activeKf} />
        </div>
      )
    }
  }

  // Timeline focus: show keyframe/frame info
  if (inspectorFocus === 'timeline' && selectedKfData) {
    return (
      <div className="inspector">
        <div className="inspector-section">
          <div className="inspector-section-title">
            Keyframe — Frame {selectedKfData.kf.frame}
          </div>
          <div className="inspector-section-subtitle">
            {selectedKfData.layer.name}
          </div>
        </div>

        <TweenSection layerId={selectedKfData.layer.id} kf={selectedKfData.kf} />
      </div>
    )
  }

  // Default: scene + layer properties
  return (
    <div className="inspector">
      <SceneSection />
      {activeLayer && <LayerSection layer={activeLayer} />}
    </div>
  )
}

function NumericInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [editing, setEditing] = useState<string | null>(null)

  const commit = () => {
    if (editing === null) return
    const n = Number(editing)
    if (!isNaN(n) && n > 0) onCommit(n)
    setEditing(null)
  }

  return (
    <input
      className="inspector-input"
      type="text"
      value={editing !== null ? editing : String(value)}
      onChange={(e) => setEditing(e.target.value)}
      onFocus={() => setEditing(String(value))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
    />
  )
}

function SceneSection() {
  const project = useStore((s) => s.project)
  const setFrameRate = useStore((s) => s.setFrameRate)
  const setProjectDimensions = useStore((s) => s.setProjectDimensions)
  const setTotalFrames = useStore((s) => s.setTotalFrames)

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Scene</div>
      <div className="inspector-row">
        <span className="inspector-label">FPS</span>
        <NumericInput value={project.frameRate} onCommit={setFrameRate} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Width</span>
        <NumericInput value={project.width} onCommit={(w) => setProjectDimensions(w, project.height)} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Height</span>
        <NumericInput value={project.height} onCommit={(h) => setProjectDimensions(project.width, h)} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Frames</span>
        <NumericInput value={project.totalFrames} onCommit={setTotalFrames} />
      </div>
    </div>
  )
}

function LayerSection({ layer }: { layer: { id: string; name: string; visible: boolean; locked: boolean } }) {
  const renameLayer = useStore((s) => s.renameLayer)
  const toggleLayerVisibility = useStore((s) => s.toggleLayerVisibility)
  const toggleLayerLocked = useStore((s) => s.toggleLayerLocked)
  const [editingName, setEditingName] = useState<string | null>(null)

  const commitName = () => {
    if (editingName !== null && editingName.trim()) {
      renameLayer(layer.id, editingName.trim())
    }
    setEditingName(null)
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Layer</div>
      <div className="inspector-row">
        <span className="inspector-label">Name</span>
        <input
          className="inspector-input"
          style={{ width: 100 }}
          type="text"
          value={editingName !== null ? editingName : layer.name}
          onChange={(e) => setEditingName(e.target.value)}
          onFocus={() => setEditingName(layer.name)}
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === 'Enter') commitName() }}
        />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Visible</span>
        <button
          className={`inspector-toggle${layer.visible ? ' active' : ''}`}
          onClick={() => toggleLayerVisibility(layer.id)}
        >
          {layer.visible ? 'Yes' : 'No'}
        </button>
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Locked</span>
        <button
          className={`inspector-toggle${layer.locked ? ' active' : ''}`}
          onClick={() => toggleLayerLocked(layer.id)}
        >
          {layer.locked ? 'Yes' : 'No'}
        </button>
      </div>
    </div>
  )
}
