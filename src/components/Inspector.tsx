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
  const selectedObjectId = useStore((s) => s.selectedObjectId)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const currentFrame = useStore((s) => s.currentFrame)
  const updateObjectAttrs = useStore((s) => s.updateObjectAttrs)

  // Find selected object on the active keyframe
  const activeLayer = project.layers.find((l) => l.id === activeLayerId)
  const activeKf = activeLayer?.keyframes.find((k) => k.frame === currentFrame)
  const selectedObj = selectedObjectId && activeKf
    ? activeKf.objects.find((o) => o.id === selectedObjectId)
    : null

  // Mode 1: Object selected on a keyframe
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

  // Mode 2: Keyframe selected (no object)
  const selectedKfData = selectedKeyframe
    ? (() => {
        const layer = project.layers.find((l) => l.id === selectedKeyframe.layerId)
        const kf = layer?.keyframes.find((k) => k.frame === selectedKeyframe.frame)
        return kf ? { layer: layer!, kf } : null
      })()
    : null

  if (selectedKfData) {
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

        <div className="inspector-section">
          <div className="inspector-section-title">
            Objects ({selectedKfData.kf.objects.length})
          </div>
          {selectedKfData.kf.objects.length === 0 ? (
            <div className="inspector-empty">No objects</div>
          ) : (
            selectedKfData.kf.objects.map((obj) => (
              <div key={obj.id} className="inspector-object-row">
                <span className="inspector-object-type">{obj.type}</span>
                <span className="inspector-object-id">{obj.id.slice(-6)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // Mode 3: Nothing selected — scene properties
  return (
    <div className="inspector">
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

      <div className="inspector-section">
        <div className="inspector-section-title">Properties</div>
        <div className="inspector-empty">Select a keyframe or object</div>
      </div>
    </div>
  )
}
