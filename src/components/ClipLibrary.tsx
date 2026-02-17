import { useState } from 'react'
import { useStore } from '../store'
import type { ClipDefinition } from '../types/project'
import './ClipLibrary.css'

export function ClipLibrary() {
  const clips = useStore((s) => s.project.clips)
  const renameClip = useStore((s) => s.renameClip)
  const deleteClipDefinition = useStore((s) => s.deleteClipDefinition)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const handleStartRename = (clip: ClipDefinition) => {
    setEditingId(clip.id)
    setEditName(clip.name)
  }

  const handleFinishRename = () => {
    if (editingId && editName.trim()) {
      renameClip(editingId, editName.trim())
    }
    setEditingId(null)
  }

  const handleDoubleClick = (clip: ClipDefinition) => {
    // Find an instance of this clip on the current frame to enter it
    const s = useStore.getState()
    for (const layer of s.project.layers) {
      for (const kf of layer.keyframes) {
        if (kf.frame !== s.currentFrame) continue
        for (const obj of kf.objects) {
          if (obj.type === 'clip' && obj.attrs.clipId === clip.id) {
            s.enterClip(obj.id, layer.id, clip.id)
            return
          }
        }
      }
    }
    // No instance found on current frame — just enter with a dummy
    // (user would typically double-click an instance on canvas instead)
  }

  if (clips.length === 0) {
    return <div className="clip-library-empty">No clips. Select objects and press F8 to create one.</div>
  }

  return (
    <div className="clip-library">
      {clips.map((clip) => (
        <div
          key={clip.id}
          className="clip-library-item"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-flick-clip', clip.id)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          onDoubleClick={() => handleDoubleClick(clip)}
        >
          <span className="clip-icon">&#9654;</span>
          {editingId === clip.id ? (
            <input
              className="clip-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleFinishRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishRename()
                if (e.key === 'Escape') setEditingId(null)
              }}
              autoFocus
            />
          ) : (
            <span
              className="clip-name"
              onDoubleClick={(e) => {
                e.stopPropagation()
                handleStartRename(clip)
              }}
            >
              {clip.name}
            </span>
          )}
          <span className="clip-info">{clip.layers.length}L / {clip.totalFrames}f</span>
          <button
            className="clip-delete"
            onClick={(e) => {
              e.stopPropagation()
              deleteClipDefinition(clip.id)
            }}
            title="Delete clip definition"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
