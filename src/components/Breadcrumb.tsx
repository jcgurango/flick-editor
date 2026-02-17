import { useStore } from '../store'
import type { EditContextEntry } from '../store'
import './Breadcrumb.css'

export function Breadcrumb() {
  const editContext = useStore((s) => s.editContext)
  const project = useStore((s) => s.project)
  const exitToStage = useStore((s) => s.exitToStage)
  const exitEditContext = useStore((s) => s.exitEditContext)

  if (editContext.length === 0) return null

  const getEntryLabel = (entry: EditContextEntry, _index: number): string => {
    if (entry.type === 'clip' && entry.clipId) {
      const clip = project.clips.find((c) => c.id === entry.clipId)
      return clip?.name ?? 'Clip'
    }
    return 'Group'
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
