import { useState } from 'react'
import { useStore } from '../store'
import { getActiveKeyframe } from '../types/project'
import type { FlickObject } from '../types/project'
import './Hierarchy.css'

const TYPE_ICONS: Record<string, string> = {
  rect: '▭',
  ellipse: '◯',
  path: '✎',
  line: '╱',
  group: '▣',
  circle: '◯',
  text: 'T',
}

type DragState =
  | { kind: 'object'; objectId: string; fromLayerId: string }
  | { kind: 'layer'; layerId: string }

export function Hierarchy() {
  const project = useStore((s) => s.project)
  const currentFrame = useStore((s) => s.currentFrame)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const setActiveLayerId = useStore((s) => s.setActiveLayerId)
  const setSelectedLayerIds = useStore((s) => s.setSelectedLayerIds)
  const setSelectedObjectIds = useStore((s) => s.setSelectedObjectIds)
  const setInspectorFocus = useStore((s) => s.setInspectorFocus)
  const reorderObject = useStore((s) => s.reorderObject)
  const moveObjectToLayer = useStore((s) => s.moveObjectToLayer)
  const reorderLayer = useStore((s) => s.reorderLayer)

  const enterGroup = useStore((s) => s.enterGroup)

  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dropTarget, setDropTarget] = useState<{ layerId: string; index: number } | null>(null)
  const [layerDropIndex, setLayerDropIndex] = useState<number | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const handleObjDragStart = (objectId: string, layerId: string, e: React.DragEvent) => {
    setDragState({ kind: 'object', objectId, fromLayerId: layerId })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', objectId)
  }

  const handleLayerDragStart = (layerId: string, e: React.DragEvent) => {
    setDragState({ kind: 'layer', layerId })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', layerId)
  }

  const handleDragEnd = () => {
    setDragState(null)
    setDropTarget(null)
    setLayerDropIndex(null)
  }

  const handleObjDrop = (targetLayerId: string, insertIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    if (!dragState || dragState.kind !== 'object') return
    const { objectId, fromLayerId } = dragState
    if (fromLayerId === targetLayerId) {
      reorderObject(targetLayerId, objectId, insertIndex)
    } else {
      moveObjectToLayer(objectId, fromLayerId, targetLayerId, insertIndex)
    }
    handleDragEnd()
  }

  const handleLayerDrop = (targetIndex: number, e: React.DragEvent) => {
    e.preventDefault()
    if (!dragState || dragState.kind !== 'layer') return
    reorderLayer(dragState.layerId, targetIndex)
    handleDragEnd()
  }

  const toggleExpanded = (id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const renderObject = (obj: FlickObject, i: number, layerId: string, total: number, depth = 0) => {
    const isSelected = selectedObjectIds.includes(obj.id)
    const isDragging = dragState?.kind === 'object' && dragState.objectId === obj.id
    const showDropBefore = depth === 0 && dropTarget?.layerId === layerId && dropTarget.index === i
    const showDropAfter = depth === 0 && dropTarget?.layerId === layerId && dropTarget.index === i + 1 && i === total - 1
    const isGroup = obj.type === 'group'
    const isExpanded = expandedGroups.has(obj.id)
    const children = isGroup ? ((obj.attrs.children as FlickObject[]) ?? []) : []

    return (
      <div key={obj.id}>
        {showDropBefore && <div className="hierarchy-drop-indicator" />}
        <div
          className={[
            'hierarchy-object',
            isSelected && 'selected',
            isDragging && 'dragging',
          ].filter(Boolean).join(' ')}
          style={depth > 0 ? { paddingLeft: 8 + depth * 12 } : undefined}
          draggable={depth === 0}
          onDragStart={depth === 0 ? (e) => { e.stopPropagation(); handleObjDragStart(obj.id, layerId, e) } : undefined}
          onDragEnd={depth === 0 ? handleDragEnd : undefined}
          onDragOver={depth === 0 ? (e) => {
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = 'move'
            if (dragState?.kind === 'object') {
              const rect = e.currentTarget.getBoundingClientRect()
              const midY = rect.top + rect.height / 2
              setDropTarget({ layerId, index: e.clientY < midY ? i : i + 1 })
            }
          } : undefined}
          onDrop={depth === 0 ? (e) => {
            e.stopPropagation()
            const rect = e.currentTarget.getBoundingClientRect()
            const midY = rect.top + rect.height / 2
            handleObjDrop(layerId, e.clientY < midY ? i : i + 1, e)
          } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (e.ctrlKey || e.metaKey) {
              useStore.getState().toggleSelectedObjectId(obj.id)
            } else {
              setSelectedObjectIds([obj.id])
            }
            setActiveLayerId(layerId)
            setInspectorFocus('canvas')
          }}
          onDoubleClick={isGroup ? (e) => {
            e.stopPropagation()
            enterGroup(obj.id, layerId)
          } : undefined}
        >
          {isGroup && (
            <span
              className="hierarchy-group-chevron"
              onClick={(e) => { e.stopPropagation(); toggleExpanded(obj.id) }}
            >
              {isExpanded ? '▾' : '▸'}
            </span>
          )}
          <span className="hierarchy-object-icon">
            {TYPE_ICONS[obj.type] ?? '?'}
          </span>
          <span className="hierarchy-object-type">{obj.type}</span>
          <span className="hierarchy-object-id">{obj.id.slice(-6)}</span>
        </div>
        {isGroup && isExpanded && (
          <div className="hierarchy-group-children">
            {children.map((child, ci) => renderObject(child, ci, layerId, children.length, depth + 1))}
          </div>
        )}
        {showDropAfter && <div className="hierarchy-drop-indicator" />}
      </div>
    )
  }

  return (
    <div className="hierarchy">
      {project.layers.map((layer, layerIdx) => {
        const activeKf = getActiveKeyframe(layer, currentFrame)
        const objects = activeKf?.objects ?? []
        const isActive = selectedLayerIds.includes(layer.id)
        const isLayerDragging = dragState?.kind === 'layer' && dragState.layerId === layer.id
        const showLayerDropBefore = dragState?.kind === 'layer' && layerDropIndex === layerIdx

        return (
          <div key={layer.id}>
            {showLayerDropBefore && <div className="hierarchy-drop-indicator layer" />}
            <div className="hierarchy-layer-group">
              <div
                className={[
                  'hierarchy-layer',
                  isActive && 'active',
                  isLayerDragging && 'dragging',
                ].filter(Boolean).join(' ')}
                draggable
                onClick={(e) => {
                  if (e.shiftKey) {
                    const s = useStore.getState()
                    const activeIdx = project.layers.findIndex((l) => l.id === s.activeLayerId)
                    const minIdx = Math.min(activeIdx, layerIdx)
                    const maxIdx = Math.max(activeIdx, layerIdx)
                    setSelectedLayerIds(project.layers.slice(minIdx, maxIdx + 1).map((l) => l.id))
                  } else if (e.ctrlKey || e.metaKey) {
                    useStore.getState().toggleSelectedLayerId(layer.id)
                  } else {
                    setSelectedLayerIds([layer.id])
                  }
                  setActiveLayerId(layer.id)
                  setInspectorFocus('layer')
                }}
                onDragStart={(e) => handleLayerDragStart(layer.id, e)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragState?.kind === 'layer') {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    setLayerDropIndex(e.clientY < midY ? layerIdx : layerIdx + 1)
                  } else if (dragState?.kind === 'object') {
                    setDropTarget({ layerId: layer.id, index: objects.length })
                  }
                }}
                onDrop={(e) => {
                  if (dragState?.kind === 'layer') {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const midY = rect.top + rect.height / 2
                    handleLayerDrop(e.clientY < midY ? layerIdx : layerIdx + 1, e)
                  } else {
                    handleObjDrop(layer.id, objects.length, e)
                  }
                }}
              >
                <span className="hierarchy-layer-icon">▸</span>
                <span className="hierarchy-layer-name">{layer.name}</span>
                <span className="hierarchy-object-count">{objects.length}</span>
              </div>
              <div className="hierarchy-objects">
                {objects.map((obj, i) => renderObject(obj, i, layer.id, objects.length))}
                {objects.length === 0 && dropTarget?.layerId === layer.id && (
                  <div className="hierarchy-drop-indicator" />
                )}
              </div>
            </div>
          </div>
        )
      })}
      {/* Drop indicator after last layer */}
      {dragState?.kind === 'layer' && layerDropIndex === project.layers.length && (
        <div className="hierarchy-drop-indicator layer" />
      )}
    </div>
  )
}
