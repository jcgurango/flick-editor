import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { createProject, getSingleSelectedKeyframe } from '../types/project'
import { openProject, saveProject, saveProjectAs, exportSvgSequence, clearFileHandle } from '../lib/file-io'
import './MenuBar.css'

interface MenuItem {
  label: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  separator?: boolean
}

interface MenuDef {
  id: string
  label: string
  items?: MenuItem[]
}

export function MenuBar() {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!openMenuId) return
    const handleClick = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenuId(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [openMenuId])

  // Close on Escape
  useEffect(() => {
    if (!openMenuId) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [openMenuId])

  // Read store state for context-sensitive menus
  const inspectorFocus = useStore((s) => s.inspectorFocus)
  const selectedObjectIds = useStore((s) => s.selectedObjectIds)
  const frameSelection = useStore((s) => s.frameSelection)
  const selectedLayerIds = useStore((s) => s.selectedLayerIds)
  const clipboard = useStore((s) => s.clipboard)
  const undoStack = useStore((s) => s._undoStack)
  const redoStack = useStore((s) => s._redoStack)

  // Context-sensitive copy/paste/delete labels
  const getCopyContext = (): { label: string; action: () => void; disabled: boolean } => {
    const s = useStore.getState()
    if (inspectorFocus === 'layer' && selectedLayerIds.length > 0) {
      return { label: 'Copy Layers', action: () => s.copyLayers(), disabled: false }
    }
    if (frameSelection) {
      return { label: 'Copy Frames', action: () => s.copyFrames(), disabled: false }
    }
    if (selectedObjectIds.length > 0) {
      return { label: 'Copy Objects', action: () => s.copySelectedObjects(), disabled: false }
    }
    return { label: 'Copy', action: () => {}, disabled: true }
  }

  const getPasteContext = (): { label: string; action: () => void; disabled: boolean } => {
    const s = useStore.getState()
    if (clipboard.type === 'layers') {
      return { label: 'Paste Layers', action: () => s.pasteLayers(), disabled: false }
    }
    if (clipboard.type === 'frames') {
      return { label: 'Paste Frames', action: () => s.pasteFrames(), disabled: false }
    }
    if (clipboard.type === 'objects' && clipboard.objects.length > 0) {
      return { label: 'Paste Objects', action: () => s.pasteObjects(), disabled: false }
    }
    return { label: 'Paste', action: () => {}, disabled: true }
  }

  const getDeleteContext = (): { label: string; action: () => void; disabled: boolean } => {
    const s = useStore.getState()
    if (inspectorFocus === 'canvas' && selectedObjectIds.length > 0) {
      return { label: 'Delete Objects', action: () => s.deleteSelectedObjects(), disabled: false }
    }
    if (inspectorFocus === 'timeline' && frameSelection) {
      return { label: 'Delete Frames', action: () => s.deleteFrameSelection(), disabled: false }
    }
    if (inspectorFocus === 'layer' && selectedLayerIds.length > 0) {
      return { label: 'Delete Layers', action: () => s.deleteSelectedLayers(), disabled: false }
    }
    return { label: 'Delete', action: () => {}, disabled: true }
  }

  const copyCtx = getCopyContext()
  const pasteCtx = getPasteContext()
  const deleteCtx = getDeleteContext()

  // Menu definitions
  const menus: MenuDef[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        {
          label: 'New Project',
          shortcut: 'Ctrl+N',
          action: () => {
            clearFileHandle()
            const s = useStore.getState()
            s.resetProject(createProject())
            s.setDocumentName('')
          },
        },
        {
          label: 'Open Project',
          shortcut: 'Ctrl+O',
          action: async () => {
            const result = await openProject()
            if (result) {
              const s = useStore.getState()
              s.resetProject(result.project)
              s.setDocumentName(result.name)
            }
          },
        },
        { separator: true, label: '' },
        {
          label: 'Save Project',
          shortcut: 'Ctrl+S',
          action: async () => {
            const name = await saveProject(useStore.getState().project)
            if (name) useStore.getState().setDocumentName(name)
          },
        },
        {
          label: 'Save Project As',
          shortcut: 'Ctrl+Shift+S',
          action: async () => {
            const name = await saveProjectAs(useStore.getState().project)
            if (name) useStore.getState().setDocumentName(name)
          },
        },
        { separator: true, label: '' },
        {
          label: 'Export SVG Sequence',
          action: () => exportSvgSequence(useStore.getState().project),
        },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          shortcut: 'Ctrl+Z',
          action: () => useStore.getState().undo(),
          disabled: undoStack.length === 0,
        },
        {
          label: 'Redo',
          shortcut: 'Ctrl+Shift+Z',
          action: () => useStore.getState().redo(),
          disabled: redoStack.length === 0,
        },
        { separator: true, label: '' },
        {
          label: copyCtx.label,
          shortcut: 'Ctrl+C',
          action: copyCtx.action,
          disabled: copyCtx.disabled,
        },
        {
          label: pasteCtx.label,
          shortcut: 'Ctrl+V',
          action: pasteCtx.action,
          disabled: pasteCtx.disabled,
        },
        {
          label: deleteCtx.label,
          shortcut: 'Del',
          action: deleteCtx.action,
          disabled: deleteCtx.disabled,
        },
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      items: [
        {
          label: 'Keyframe',
          shortcut: 'F6',
          action: () => {
            const s = useStore.getState()
            const sel = getSingleSelectedKeyframe(s.frameSelection)
            const layerId = sel?.layerId ?? s.activeLayerId
            if (layerId) {
              s.insertKeyframe(layerId, s.currentFrame)
              s.setFrameSelection({ layerIds: [layerId], startFrame: s.currentFrame, endFrame: s.currentFrame })
            }
          },
        },
        {
          label: 'Blank Keyframe',
          shortcut: 'F7',
          action: () => {
            const s = useStore.getState()
            const sel = getSingleSelectedKeyframe(s.frameSelection)
            const layerId = sel?.layerId ?? s.activeLayerId
            if (layerId) {
              s.insertBlankKeyframe(layerId, s.currentFrame)
              s.setFrameSelection({ layerIds: [layerId], startFrame: s.currentFrame, endFrame: s.currentFrame })
            }
          },
        },
        { separator: true, label: '' },
        {
          label: 'Layer',
          action: () => useStore.getState().addLayer(),
        },
      ],
    },
    {
      id: 'object',
      label: 'Object',
      items: [
        {
          label: 'Group',
          shortcut: 'Ctrl+G',
          action: () => useStore.getState().groupSelectedObjects(),
          disabled: selectedObjectIds.length < 2,
        },
        {
          label: 'Break Apart',
          shortcut: 'Ctrl+Shift+G',
          action: () => useStore.getState().ungroupSelectedObject(),
          disabled: (() => {
            if (selectedObjectIds.length !== 1) return true
            const s = useStore.getState()
            const layer = s.project.layers.find((l) => l.id === s.activeLayerId)
            const kf = layer?.keyframes.find((k) => k.frame === s.currentFrame)
            const obj = kf?.objects.find((o) => o.id === selectedObjectIds[0])
            return !obj || obj.type !== 'group'
          })(),
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        {
          label: 'Recenter View',
          shortcut: '?',
          action: () => useStore.getState().recenterView(),
        },
        {
          label: '100%',
          shortcut: '/',
          action: () => useStore.getState().setView100(),
        },
      ],
    },
    { id: 'modify', label: 'Modify' },
    { id: 'control', label: 'Control' },
    { id: 'help', label: 'Help' },
  ]

  return (
    <div className="menu-bar" ref={barRef}>
      {menus.map((menu) => (
        <div className="menu-trigger-wrapper" key={menu.id}>
          <button
            className={[
              'menu-trigger',
              openMenuId === menu.id && 'active',
              !menu.items && 'placeholder',
            ].filter(Boolean).join(' ')}
            onClick={() => {
              if (!menu.items) return
              setOpenMenuId(openMenuId === menu.id ? null : menu.id)
            }}
            onMouseEnter={() => {
              if (openMenuId && menu.items) setOpenMenuId(menu.id)
            }}
          >
            {menu.label}
          </button>
          {openMenuId === menu.id && menu.items && (
            <div className="menu-dropdown">
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div className="menu-separator" key={i} />
                ) : (
                  <button
                    className="menu-item"
                    key={i}
                    disabled={item.disabled}
                    onClick={() => {
                      item.action?.()
                      setOpenMenuId(null)
                    }}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
