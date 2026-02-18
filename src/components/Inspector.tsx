import { useState } from 'react'
import { useStore, getActiveTimeline } from '../store'
import type { TweenType, EaseDirection } from '../types/project'
import { getSingleSelectedKeyframe } from '../types/project'
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

function TweenSection({ layerId, kf }: { layerId: string; kf: { frame: number; tween: TweenType; easeDirection: EaseDirection; loop?: boolean } }) {
  const setKeyframeTween = useStore((s) => s.setKeyframeTween)
  const setKeyframeEaseDirection = useStore((s) => s.setKeyframeEaseDirection)
  const setKeyframeLoop = useStore((s) => s.setKeyframeLoop)

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
      <div className="inspector-row">
        <span className="inspector-label">Loop</span>
        <button
          className={`inspector-toggle${kf.loop ? ' active' : ''}`}
          disabled={kf.tween === 'discrete'}
          onClick={() => setKeyframeLoop(layerId, kf.frame, !kf.loop)}
        >
          {kf.loop ? 'Yes' : 'No'}
        </button>
      </div>
    </div>
  )
}

export function Inspector() {
  const project = useStore((s) => s.project)
  const frameSelection = useStore((s) => s.frameSelection)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const currentFrame = useStore((s) => s.currentFrame)
  const updateObjectAttrs = useStore((s) => s.updateObjectAttrs)
  const inspectorFocus = useStore((s) => s.inspectorFocus)
  const editContext = useStore((s) => s.editContext)
  const updateObjectInEditContext = useStore((s) => s.updateObjectInEditContext)

  // Active timeline (project or clip)
  const activeTimeline = useStore((s) => getActiveTimeline(s))
  const activeLayers = activeTimeline.layers

  // Find selected object — either in edit context or on the active keyframe
  const activeLayer = activeLayers.find((l) => l.id === activeLayerId)
  const activeKf = activeLayer?.keyframes.find((k) => k.frame === currentFrame)

  const selectedObj = (() => {
    if (selectedObjectIds.length !== 1) return null
    if (editContext.length > 0) {
      const lastEntry = editContext[editContext.length - 1]
      if (lastEntry.type === 'clip') {
        // Clip edit (including nested clips) — object is on the active document's keyframe
        return activeKf?.objects.find((o) => o.id === selectedObjectIds[0]) ?? null
      }
      // Group edit — find the last clip entry (if any) to determine starting point
      let clipIdx = -1
      for (let i = editContext.length - 1; i >= 0; i--) {
        if (editContext[i].type === 'clip') { clipIdx = i; break }
      }
      const groupEntries = clipIdx !== -1 ? editContext.slice(clipIdx + 1) : editContext
      // Get starting objects: from clip's active layer or from project layer
      let currentObjs: import('../types/project').FlickObject[]
      if (clipIdx !== -1) {
        // Groups after a clip — start from the clip's active layer keyframe
        const groupRoot = groupEntries[0]
        const groupLayer = activeLayers.find((l) => l.id === groupRoot.layerId)
        if (!groupLayer) return null
        const kf = groupLayer.keyframes.find((k) => k.frame === currentFrame)
        if (!kf) return null
        currentObjs = kf.objects
      } else {
        // Pure group edit — start from project layer
        const rootEntry = editContext[0]
        const rootLayer = project.layers.find((l) => l.id === rootEntry.layerId)
        if (!rootLayer) return null
        const kf = rootLayer.keyframes.find((k) => k.frame === currentFrame)
        if (!kf) return null
        currentObjs = kf.objects
      }
      // Walk group chain
      for (const entry of groupEntries) {
        const grp = currentObjs.find((o) => o.id === entry.objectId)
        if (grp?.type === 'group') {
          currentObjs = (grp.attrs.children as import('../types/project').FlickObject[]) ?? []
        } else return null
      }
      return currentObjs.find((o) => o.id === selectedObjectIds[0]) ?? null
    }
    return activeKf?.objects.find((o) => o.id === selectedObjectIds[0]) ?? null
  })()

  // Resolve keyframe data for single-cell timeline selection
  const singleSel = getSingleSelectedKeyframe(frameSelection)
  const selectedKfData = singleSel
    ? (() => {
        const layer = activeLayers.find((l) => l.id === singleSel.layerId)
        const kf = layer?.keyframes.find((k) => k.frame === singleSel.frame)
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
          {editContext.length === 0 && <TweenSection layerId={activeLayer.id} kf={activeKf} />}
        </div>
      )
    }

    // Single object selected
    if (selectedObj && activeLayer && activeKf) {
      const fields = OBJECT_FIELDS[selectedObj.type] ?? []
      const typeName = TYPE_NAMES[selectedObj.type] ?? selectedObj.type
      const inEditCtx = editContext.length > 0

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
                onChange={(val) => {
                  if (inEditCtx) {
                    updateObjectInEditContext(selectedObj.id, { [field.key]: val })
                  } else {
                    updateObjectAttrs(activeLayer.id, activeKf.frame, selectedObj.id, { [field.key]: val })
                  }
                }}
              />
            ))}
          </div>

          {!inEditCtx && <TweenSection layerId={activeLayer.id} kf={activeKf} />}
        </div>
      )
    }
  }

  // Layer focus: show layer properties
  if (inspectorFocus === 'layer' && activeLayer) {
    return (
      <div className="inspector">
        <SceneSection />
        <LayerSection layer={activeLayer} />
      </div>
    )
  }

  // Timeline focus: show keyframe/frame info
  if (inspectorFocus === 'timeline' && frameSelection) {
    if (selectedKfData) {
      // Single-cell selection with a keyframe
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

    // Multi-frame or non-keyframe selection summary
    const frameCount = frameSelection.endFrame - frameSelection.startFrame + 1
    const layerCount = frameSelection.layerIds.length
    if (frameCount > 1 || layerCount > 1) {
      return (
        <div className="inspector">
          <div className="inspector-section">
            <div className="inspector-section-title">Frame Selection</div>
            <div className="inspector-section-subtitle">
              {layerCount} layer{layerCount > 1 ? 's' : ''}, {frameCount} frame{frameCount > 1 ? 's' : ''}
            </div>
            <div className="inspector-row">
              <span className="inspector-label">Frames</span>
              <span>{frameSelection.startFrame}–{frameSelection.endFrame}</span>
            </div>
          </div>
        </div>
      )
    }
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
  const activeTimeline = useStore((s) => getActiveTimeline(s))
  const editContext = useStore((s) => s.editContext)
  const setFrameRate = useStore((s) => s.setFrameRate)
  const setProjectDimensions = useStore((s) => s.setProjectDimensions)
  const setTotalFrames = useStore((s) => s.setTotalFrames)
  const isClipEdit = editContext.some(e => e.type === 'clip')

  if (isClipEdit) {
    return (
      <div className="inspector-section">
        <div className="inspector-section-title">Clip</div>
        <div className="inspector-row">
          <span className="inspector-label">Frames</span>
          <NumericInput value={activeTimeline.totalFrames} onCommit={setTotalFrames} />
        </div>
      </div>
    )
  }

  return (
    <div className="inspector-section">
      <div className="inspector-section-title">Scene</div>
      <div className="inspector-row">
        <span className="inspector-label">FPS</span>
        <NumericInput value={activeTimeline.frameRate} onCommit={setFrameRate} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Width</span>
        <NumericInput value={activeTimeline.width} onCommit={(w) => setProjectDimensions(w, activeTimeline.height)} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Height</span>
        <NumericInput value={activeTimeline.height} onCommit={(h) => setProjectDimensions(activeTimeline.width, h)} />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Frames</span>
        <NumericInput value={activeTimeline.totalFrames} onCommit={setTotalFrames} />
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
