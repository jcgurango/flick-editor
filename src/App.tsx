import { useEffect, useRef } from 'react';
import { MenuBar } from './components/MenuBar';
import { Canvas } from './components/Canvas';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { useProjectStore, isClipMode, editingClipId } from './store/projectStore';
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
  const play = useProjectStore((s) => s.play);
  const stop = useProjectStore((s) => s.stop);
  const projectPath = useProjectStore((s) => s.projectPath);
  const dirty = useProjectStore((s) => s.dirty);
  const name = useProjectStore((s) => s.name);

  // ── Clip mode sync ────────────────────────────────────────

  const syncingRef = useRef(false);

  useEffect(() => {
    if (!isClipMode || !editingClipId) return;

    // Request initial state from main window
    window.api.requestClipState(editingClipId);

    // Listen for state updates from main window
    const cleanupStateUpdate = window.api.onClipStateUpdate((clipData, meta) => {
      syncingRef.current = true;
      const store = useProjectStore.getState();
      useProjectStore.setState({
        layers: clipData.layers,
        width: clipData.width,
        height: clipData.height,
        totalFrames: clipData.totalFrames,
        name: clipData.name,
        canUndo: meta.canUndo,
        canRedo: meta.canRedo,
        dirty: meta.dirty,
        fps: meta.fps,
        projectPath: meta.projectPath,
      });
      store.recomposite();
      setTimeout(() => { syncingRef.current = false; }, 0);
    });

    // Listen for meta-only updates (dirty, fps, canUndo, canRedo)
    const cleanupMetaUpdate = window.api.onClipMetaUpdate((meta) => {
      useProjectStore.setState({
        canUndo: meta.canUndo,
        canRedo: meta.canRedo,
        dirty: meta.dirty,
        fps: meta.fps,
        projectPath: meta.projectPath,
      });
    });

    return () => {
      cleanupStateUpdate();
      cleanupMetaUpdate();
    };
  }, []);

  // Subscribe to local store changes and sync back to main window (clip mode)
  useEffect(() => {
    if (!isClipMode || !editingClipId) return;

    const unsub = useProjectStore.subscribe((state, prev) => {
      if (syncingRef.current) return;
      // Only sync if relevant fields changed
      if (
        state.layers !== prev.layers ||
        state.width !== prev.width ||
        state.height !== prev.height ||
        state.totalFrames !== prev.totalFrames ||
        state.name !== prev.name
      ) {
        window.api.syncClipState(editingClipId!, {
          layers: state.layers,
          width: state.width,
          height: state.height,
          totalFrames: state.totalFrames,
          name: state.name,
        });
      }
    });

    return unsub;
  }, []);

  // ── Main window: handle clip IPC ──────────────────────────

  useEffect(() => {
    if (isClipMode) return;

    const cleanupSync = window.api.onClipIncomingSync((clipId, clipData) => {
      const store = useProjectStore.getState();
      // Push undo, update clip, recomposite
      // We need to manually push undo here (not via the store's pushUndo
      // which is only called from actions)
      const { layers, clips, undoStack } = store;
      const newStack = [...undoStack, { layers, clips }].slice(-50);
      const updatedClips = store.clips.map((c) =>
        c.id === clipId
          ? { ...c, layers: clipData.layers, width: clipData.width, height: clipData.height, totalFrames: clipData.totalFrames, name: clipData.name }
          : c
      );
      useProjectStore.setState({
        undoStack: newStack, redoStack: [], canUndo: true, canRedo: false, dirty: true,
        clips: updatedClips,
      });
      store.recomposite();

      // Broadcast updated meta back to clip window
      const updated = useProjectStore.getState();
      window.api.broadcastClipState(clipId, clipData, {
        canUndo: updated.canUndo,
        canRedo: updated.canRedo,
        dirty: updated.dirty,
        fps: updated.fps,
        projectPath: updated.projectPath,
      });
    });

    const cleanupUndoReq = window.api.onClipUndoRequest((clipId) => {
      const store = useProjectStore.getState();
      store.undo();
      // After undo, broadcast updated clip state back
      const updated = useProjectStore.getState();
      const clip = updated.clips.find((c) => c.id === clipId);
      if (clip) {
        window.api.broadcastClipState(clipId, {
          layers: clip.layers,
          width: clip.width,
          height: clip.height,
          totalFrames: clip.totalFrames,
          name: clip.name,
        }, {
          canUndo: updated.canUndo,
          canRedo: updated.canRedo,
          dirty: updated.dirty,
          fps: updated.fps,
          projectPath: updated.projectPath,
        });
      }
    });

    const cleanupRedoReq = window.api.onClipRedoRequest((clipId) => {
      const store = useProjectStore.getState();
      store.redo();
      const updated = useProjectStore.getState();
      const clip = updated.clips.find((c) => c.id === clipId);
      if (clip) {
        window.api.broadcastClipState(clipId, {
          layers: clip.layers,
          width: clip.width,
          height: clip.height,
          totalFrames: clip.totalFrames,
          name: clip.name,
        }, {
          canUndo: updated.canUndo,
          canRedo: updated.canRedo,
          dirty: updated.dirty,
          fps: updated.fps,
          projectPath: updated.projectPath,
        });
      }
    });

    const cleanupSaveReq = window.api.onClipSaveRequest(() => {
      useProjectStore.getState().saveProject();
    });

    const cleanupStateReq = window.api.onClipStateRequest((clipId) => {
      const state = useProjectStore.getState();
      const clip = state.clips.find((c) => c.id === clipId);
      if (clip) {
        window.api.broadcastClipState(clipId, {
          layers: clip.layers,
          width: clip.width,
          height: clip.height,
          totalFrames: clip.totalFrames,
          name: clip.name,
        }, {
          canUndo: state.canUndo,
          canRedo: state.canRedo,
          dirty: state.dirty,
          fps: state.fps,
          projectPath: state.projectPath,
        });
      }
    });

    // Subscribe to meta changes and broadcast to all clip windows
    const unsubMeta = useProjectStore.subscribe((state, prev) => {
      if (
        state.dirty !== prev.dirty ||
        state.fps !== prev.fps ||
        state.canUndo !== prev.canUndo ||
        state.canRedo !== prev.canRedo ||
        state.projectPath !== prev.projectPath
      ) {
        window.api.broadcastClipMetaToAll({
          canUndo: state.canUndo,
          canRedo: state.canRedo,
          dirty: state.dirty,
          fps: state.fps,
          projectPath: state.projectPath,
        });
      }
    });

    return () => {
      cleanupSync();
      cleanupUndoReq();
      cleanupRedoReq();
      cleanupSaveReq();
      cleanupStateReq();
      unsubMeta();
    };
  }, []);

  // ── Title ──────────────────────────────────────────────────

  useEffect(() => {
    if (isClipMode) {
      const clipName = name || editingClipId || 'Clip';
      const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : 'Untitled';
      document.title = `${dirty ? '* ' : ''}${folderName} — [${clipName}] — Flick`;
    } else {
      const folderName = projectPath ? projectPath.split(/[\\/]/).pop() : null;
      document.title = folderName
        ? `${dirty ? '* ' : ''}${folderName} — Flick`
        : 'Flick';
    }
  }, [projectPath, dirty, name]);

  // ── Keyboard shortcuts ────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === 's') {
        e.preventDefault();
        saveProject();
        return;
      }

      // Play/pause — Space (only when not focused on an input)
      if (e.key === ' ' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        const state = useProjectStore.getState();
        if (state.playing) {
          stop();
        } else {
          play();
        }
        return;
      }

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
        if (state.selectedLayerId) {
          addKeyframe(state.selectedLayerId, state.currentFrame, e.key === 'F6');
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, copySelection, pasteAtSelection, deleteSelection, removeLayer, saveProject, resetCanvasView, setCanvasZoom100, addKeyframe, play, stop]);

  return (
    <div className="app">
      <MenuBar isClipMode={isClipMode} />
      <div className="app-body">
        <div className="app-main">
          <Canvas />
          <Timeline />
        </div>
        <Inspector isClipMode={isClipMode} />
      </div>
    </div>
  );
}

export default App;
