import { useState, useRef } from 'react'
import { useStore } from '../store'
import { getActiveKeyframe } from '../types/project'
import './Hierarchy.css'

const TYPE_ICONS: Record<string, string> = {
  rect: '▭',
  ellipse: '◯',
  path: '✎',
  line: '╱',
}

interface DragState {
  objectId: string
  fromLayerId: string
}

export function Hierarchy() {
  const project = useStore((s) => s.project)
  const currentFrame = useStore((s) => s.currentFrame)
  const activeLayerId = useStore((s) => s.activeLayerId)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const setSelectedObjectIds = useStore((s) => s.setSelectedObjectIds)
  const setInspectorFocus = useStore((s) => s.setInspectorFocus)
  const reorderObject = useStore((s) => s.reorderObject)
  const moveObjectToLayer = useStore((s) => s.moveObjectToLayer)

  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTarget, setDropTarget] = useState<{ layerId: string; index: number } | null>(null)
  const dragCounterRef = useRef(0)

  const handleDragStart = (objectId: string, layerId: string, e: React.DragEvent) => {
    setDragState({ objectId, fromLayerId: layerId })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', objectId)
  }

  const handleDragEnd = () => {
    setDragState(null)
    setDropTarget(null)
    dragCounterRef.current = 0
  }

  const handleDrop = (targetLayerId: string, insertIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    if (!dragState) return
    const { objectId, fromLayerId } = dragState
    if (fromLayerId === targetLayerId) {
      reorderObject(targetLayerId, objectId, insertIndex)
    } else {
      moveObjectToLayer(objectId, fromLayerId, targetLayerId, insertIndex)
    }
    setDragState(null)
    setDropTarget(null)
    dragCounterRef.current = 0
  }

  return (
    <div className="hierarchy">
      <div className="hierarchy-header">Hierarchy</div>
      {project.layers.map((layer) => {
        const activeKf = getActiveKeyframe(layer, currentFrame)
        const objects = activeKf?.objects ?? []
        const isActive = layer.id === activeLayerId

        return (
          <div key={layer.id} className="hierarchy-layer-group">
            <div
              className={`hierarchy-layer${isActive ? ' active' : ''}`}
              onClick={() => setActiveLayerId(layer.id)}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                if (dragState) setDropTarget({ layerId: layer.id, index: objects.length })
              }}
              onDrop={(e) => handleDrop(layer.id, objects.length, e)}
            >
              <span className="hierarchy-layer-icon">▸</span>
              <span className="hierarchy-layer-name">{layer.name}</span>
              <span className="hierarchy-object-count">{objects.length}</span>
            </div>
            <div className="hierarchy-objects">
              {objects.map((obj, i) => {
                const isSelected = selectedObjectIds.includes(obj.id)
                const isDragging = dragState?.objectId === obj.id
                const showDropBefore = dropTarget?.layerId === layer.id && dropTarget.index === i
                const showDropAfter = dropTarget?.layerId === layer.id && dropTarget.index === i + 1 && i === objects.length - 1

                return (
                  <div key={obj.id}>
                    {showDropBefore && <div className="hierarchy-drop-indicator" />}
                    <div
                      className={[
                        'hierarchy-object',
                        isSelected && 'selected',
                        isDragging && 'dragging',
                      ].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={(e) => handleDragStart(obj.id, layer.id, e)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        e.dataTransfer.dropEffect = 'move'
                        // Determine if drop is in the top or bottom half
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midY = rect.top + rect.height / 2
                        const index = e.clientY < midY ? i : i + 1
                        if (dragState) setDropTarget({ layerId: layer.id, index })
                      }}
                      onDrop={(e) => {
                        e.stopPropagation()
                        const rect = e.currentTarget.getBoundingClientRect()
                        const midY = rect.top + rect.height / 2
                        const index = e.clientY < midY ? i : i + 1
                        handleDrop(layer.id, index, e)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (e.ctrlKey || e.metaKey) {
                          useStore.getState().toggleSelectedObjectId(obj.id)
                        } else {
                          setSelectedObjectIds([obj.id])
                        }
                        setActiveLayerId(layer.id)
                        setInspectorFocus('canvas')
                      }}
                    >
                      <span className="hierarchy-object-icon">
                        {TYPE_ICONS[obj.type] ?? '?'}
                      </span>
                      <span className="hierarchy-object-type">{obj.type}</span>
                      <span className="hierarchy-object-id">{obj.id.slice(-6)}</span>
                    </div>
                    {showDropAfter && <div className="hierarchy-drop-indicator" />}
                  </div>
                )
              })}
              {objects.length === 0 && dropTarget?.layerId === layer.id && (
                <div className="hierarchy-drop-indicator" />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
