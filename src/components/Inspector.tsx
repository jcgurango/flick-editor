import { useStore } from '../store'
import type { TweenType, EaseDirection } from '../types/project'
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

export function Inspector() {
  const project = useStore((s) => s.project)
  const selectedKeyframe = useStore((s) => s.selectedKeyframe)
  const setKeyframeTween = useStore((s) => s.setKeyframeTween)
  const setKeyframeEaseDirection = useStore((s) => s.setKeyframeEaseDirection)

  // Find the selected keyframe data
  const selectedKfData = selectedKeyframe
    ? (() => {
        const layer = project.layers.find((l) => l.id === selectedKeyframe.layerId)
        const kf = layer?.keyframes.find((k) => k.frame === selectedKeyframe.frame)
        return kf ? { layer: layer!, kf } : null
      })()
    : null

  return (
    <div className="inspector">
      {selectedKfData ? (
        <>
          {/* Keyframe inspector */}
          <div className="inspector-section">
            <div className="inspector-section-title">
              Keyframe — Frame {selectedKfData.kf.frame}
            </div>
            <div className="inspector-section-subtitle">
              {selectedKfData.layer.name}
            </div>
          </div>

          <div className="inspector-section">
            <div className="inspector-section-title">Tween</div>
            <div className="inspector-row">
              <span className="inspector-label">Type</span>
              <select
                className="inspector-select"
                value={selectedKfData.kf.tween}
                onChange={(e) =>
                  setKeyframeTween(
                    selectedKeyframe!.layerId,
                    selectedKeyframe!.frame,
                    e.target.value as TweenType,
                  )
                }
              >
                {TWEEN_TYPES.map((tt) => (
                  <option key={tt.value} value={tt.value}>
                    {tt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Easing</span>
              <select
                className="inspector-select"
                value={selectedKfData.kf.easeDirection}
                disabled={selectedKfData.kf.tween === 'discrete'}
                onChange={(e) =>
                  setKeyframeEaseDirection(
                    selectedKeyframe!.layerId,
                    selectedKeyframe!.frame,
                    e.target.value as EaseDirection,
                  )
                }
              >
                {EASE_DIRS.map((ed) => (
                  <option key={ed.value} value={ed.value}>
                    {ed.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Objects in this keyframe */}
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
        </>
      ) : (
        <>
          {/* Default: scene properties */}
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
        </>
      )}
    </div>
  )
}
