import { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../store/projectStore';
import { NewProjectDialog } from './NewProjectDialog';

interface MenuItemDef {
  label: string;
  action?: () => void;
  separator?: boolean;
  shortcut?: string;
  disabled?: boolean;
}

interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

export function MenuBar() {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const resetCanvasView = useProjectStore((s) => s.resetCanvasView);
  const setCanvasZoom100 = useProjectStore((s) => s.setCanvasZoom100);
  const openProject = useProjectStore((s) => s.openProject);
  const saveProject = useProjectStore((s) => s.saveProject);
  const projectPath = useProjectStore((s) => s.projectPath);
  const dirty = useProjectStore((s) => s.dirty);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const canUndo = useProjectStore((s) => s.canUndo);
  const canRedo = useProjectStore((s) => s.canRedo);
  const copySelection = useProjectStore((s) => s.copySelection);
  const pasteAtSelection = useProjectStore((s) => s.pasteAtSelection);
  const deleteSelection = useProjectStore((s) => s.deleteSelection);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const selection = useProjectStore((s) => s.selection);
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId);
  const clipboard = useProjectStore((s) => s.clipboard);
  const editing = useProjectStore((s) => s.editingKeyframe);

  const isEditing = editing !== null;
  const hasSelection = selection !== null;
  const canDelete = hasSelection || (selectedLayerId !== null && !hasSelection);

  const handleOpen = async () => {
    setOpenMenu(null);
    const result = await window.api.showOpenDialog({
      title: 'Open Flick Project',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    const dir = result.filePaths[0];
    const hasProject = await window.api.exists(
      await window.api.pathJoin(dir, 'project.json')
    );
    if (!hasProject) return;
    await openProject(dir);
  };

  const handleSave = async () => {
    setOpenMenu(null);
    await saveProject();
  };

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        {
          label: 'New Project',
          action: () => {
            setOpenMenu(null);
            setShowNewProject(true);
          },
          disabled: isEditing,
        },
        { label: 'Open...', action: handleOpen, disabled: isEditing },
        { separator: true, label: '' },
        { label: 'Save', action: handleSave, shortcut: 'Ctrl+S' },
      ],
    },
    {
      label: 'Edit',
      items: [
        {
          label: 'Undo',
          action: () => { setOpenMenu(null); undo(); },
          shortcut: 'Ctrl+Z',
          disabled: !canUndo || isEditing,
        },
        {
          label: 'Redo',
          action: () => { setOpenMenu(null); redo(); },
          shortcut: 'Ctrl+Shift+Z',
          disabled: !canRedo || isEditing,
        },
        { separator: true, label: '' },
        {
          label: 'Copy',
          action: () => { setOpenMenu(null); copySelection(); },
          shortcut: 'Ctrl+C',
          disabled: !hasSelection || isEditing,
        },
        {
          label: 'Paste',
          action: () => { setOpenMenu(null); pasteAtSelection(); },
          shortcut: 'Ctrl+V',
          disabled: !hasSelection || !clipboard || isEditing,
        },
        { separator: true, label: '' },
        {
          label: 'Delete',
          action: () => {
            setOpenMenu(null);
            if (selection) {
              deleteSelection();
            } else if (selectedLayerId) {
              removeLayer(selectedLayerId);
            }
          },
          shortcut: 'Del',
          disabled: !canDelete || isEditing,
        },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Recenter View',
          action: () => {
            resetCanvasView();
            setOpenMenu(null);
          },
          shortcut: '/',
        },
        {
          label: '100%',
          action: () => {
            setCanvasZoom100();
            setOpenMenu(null);
          },
          shortcut: '?',
        },
      ],
    },
  ];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <>
      <div className="menu-bar" ref={menuBarRef}>
        <div className="menu-bar-brand">Flick</div>
        {menus.map((menu) => (
          <div key={menu.label} className="menu-item-wrapper">
            <button
              className={`menu-trigger ${openMenu === menu.label ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
              onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
            >
              {menu.label}
            </button>
            {openMenu === menu.label && (
              <div className="menu-dropdown">
                {menu.items.map((item, i) =>
                  item.separator ? (
                    <div key={i} className="menu-separator" />
                  ) : (
                    <button
                      key={item.label}
                      className={`menu-dropdown-item ${item.disabled ? 'disabled' : ''}`}
                      onClick={item.disabled ? undefined : item.action}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="menu-shortcut">{item.shortcut}</span>
                      )}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
        {projectPath && (
          <div className="menu-bar-project-name">
            {projectPath.split(/[\\/]/).pop()}{dirty ? ' *' : ''}
          </div>
        )}
      </div>
      {showNewProject && (
        <NewProjectDialog onClose={() => setShowNewProject(false)} />
      )}
    </>
  );
}
