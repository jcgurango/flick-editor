import { useStore } from '../store'
import type { EditContextEntry } from '../store'
import './Breadcrumb.css'

export function Breadcrumb() {
  const editContext = useStore((s) => s.editContext)
  const project = useStore((s) => s.project)
  const currentFrame = useStore((s) => s.currentFrame)
  const exitToStage = useStore((s) => s.exitToStage)
  const exitEditContext = useStore((s) => s.exitEditContext)

  if (editContext.length === 0) return null

  const getEntryLabel = (entry: EditContextEntry, _index: number): string => {
    // Find the object name from the layer
    const layer = project.layers.find((l) => l.id === entry.layerId)
    if (!layer) return entry.type
    const kf = layer.keyframes.find((k) => k.frame === currentFrame)
      ?? layer.keyframes[0]
    const obj = kf?.objects.find((o) => o.id === entry.objectId)
    if (!obj) return entry.type
    return entry.type === 'group' ? `Group` : `Clip`
  }

  const navigateTo = (depth: number) => {
    if (depth === 0) {
      exitToStage()
    } else {
      // Pop to the desired depth
      const pops = editContext.length - depth
      for (let i = 0; i < pops; i++) {
        exitEditContext()
      }
    }
  }

  return (
    <div className="breadcrumb">
      <button
        className={`breadcrumb-segment${editContext.length === 0 ? ' current' : ''}`}
        onClick={() => navigateTo(0)}
      >
        Stage
      </button>
      {editContext.map((entry, i) => (
        <span key={i}>
          <span className="breadcrumb-separator">›</span>
          <button
            className={`breadcrumb-segment${i === editContext.length - 1 ? ' current' : ''}`}
            onClick={() => navigateTo(i + 1)}
          >
            {getEntryLabel(entry, i)}
          </button>
        </span>
      ))}
    </div>
  )
}
