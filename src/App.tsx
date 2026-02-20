import { useEffect } from 'react';
import { MenuBar } from './components/MenuBar';
import { Canvas } from './components/Canvas';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { useProjectStore } from './store/projectStore';
import './App.css';

function App() {
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const copySelection = useProjectStore((s) => s.copySelection);
  const pasteAtSelection = useProjectStore((s) => s.pasteAtSelection);
  const deleteSelection = useProjectStore((s) => s.deleteSelection);
  const removeLayer = useProjectStore((s) => s.removeLayer);
  const saveProject = useProjectStore((s) => s.saveProject);
  const resetCanvasView = useProjectStore((s) => s.resetCanvasView);
  const setCanvasZoom100 = useProjectStore((s) => s.setCanvasZoom100);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const projectPath = useProjectStore((s) => s.projectPath);
  const dirty = useProjectStore((s) => s.dirty);

  useEffect(() => {
    const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : null;
    document.title = folderName
      ? `${dirty ? '* ' : ''}${folderName} — Flick`
      : 'Flick';
  }, [projectPath, dirty]);

  useEffect(() => {
    const isEditing = () => useProjectStore.getState().editingKeyframe !== null;

    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Save works even during editing
      if (ctrl && key === 's') {
        e.preventDefault();
        saveProject();
        return;
      }

      if (isEditing()) return;

      if (ctrl && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      if (ctrl && key === 'c') {
        e.preventDefault();
        copySelection();
        return;
      }

      if (ctrl && key === 'v') {
        e.preventDefault();
        pasteAtSelection();
        return;
      }

      if (e.key === 'Delete') {
        e.preventDefault();
        const state = useProjectStore.getState();
        if (state.selection) {
          deleteSelection();
        } else if (state.selectedLayerId) {
          removeLayer(state.selectedLayerId);
        }
        return;
      }

      if (e.key === '/') {
        e.preventDefault();
        resetCanvasView();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setCanvasZoom100();
        return;
      }

      if (e.key === 'F6' || e.key === 'F7') {
        e.preventDefault();
        const state = useProjectStore.getState();
        if (state.selectedLayerId && state.projectPath) {
          addKeyframe(state.selectedLayerId, state.currentFrame, e.key === 'F6');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, copySelection, pasteAtSelection, deleteSelection, removeLayer, saveProject, resetCanvasView, setCanvasZoom100, addKeyframe]);

  return (
    <div className="app">
      <MenuBar />
      <div className="app-body">
        <div className="app-main">
          <Canvas />
          <Timeline />
        </div>
        <Inspector />
      </div>
    </div>
  );
}

export default App;
