import { useEffect, useRef } from 'react';
import { MenuBar } from './components/MenuBar';
import { Canvas } from './components/Canvas';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { useProjectStore, isClipMode, editingClipId, propagateClipDimensionsAll } from './store/projectStore';
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
        ...(clipData.clips !== undefined ? { clips: clipData.clips } : {}),
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
      // recomposite handles syncClipsToInkscape and staleness-checks before reloading
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
      const { layers, clips, undoStack } = store;
      const oldClip = clips.find((c) => c.id === clipId);

      // First apply the incoming clip update
      let updatedClips = clips.map((c) =>
        c.id === clipId
          ? { ...c, layers: clipData.layers, width: clipData.width, height: clipData.height, totalFrames: clipData.totalFrames, name: clipData.name }
          : c
      );

      // Propagate dimension changes through state.layers AND all clips-within-clips
      let updatedLayers = layers;
      if (oldClip && (oldClip.width !== clipData.width || oldClip.height !== clipData.height)) {
        const propagated = propagateClipDimensionsAll(
          layers, updatedClips, clipId,
          oldClip.width, oldClip.height,
          clipData.width, clipData.height,
        );
        updatedLayers = propagated.layers;
        updatedClips = propagated.clips;
      }

      const newStack = [...undoStack, { layers, clips }].slice(-50);
      useProjectStore.setState({
        undoStack: newStack, redoStack: [], canUndo: true, canRedo: false, dirty: true,
        clips: updatedClips,
        layers: updatedLayers,
      });
      store.recomposite();
      // unsubClips subscription handles broadcasting to all editors
    });

    const cleanupUndoReq = window.api.onClipUndoRequest((clipId) => {
      const store = useProjectStore.getState();
      store.undo();
      // After undo, broadcast updated clip state back
      const updated = useProjectStore.getState();
      // unsubClips subscription handles broadcasting to all editors
    });

    const cleanupRedoReq = window.api.onClipRedoRequest((clipId) => {
      const store = useProjectStore.getState();
      store.redo();
      // unsubClips subscription handles broadcasting to all editors
    });

    const cleanupSaveReq = window.api.onClipSaveRequest(() => {
      useProjectStore.getState().saveProject();
    });

    const cleanupNClip = window.api.onClipNClip((ownerClipId, data) => {
      const store = useProjectStore.getState();
      // Update the owner clip's layers (replace element with placeholder) and add the new clip
      const updatedClips = store.clips.map((c) => {
        if (c.id !== ownerClipId) return c;
        return {
          ...c,
          layers: c.layers.map((l) => {
            if (l.id !== data.layerId) return l;
            return {
              ...l,
              keyframes: l.keyframes.map((k) =>
                k.frame === data.frame ? { ...k, svgContent: data.newSvgContent } : k
              ),
            };
          }),
        };
      });
      useProjectStore.setState({ clips: [...updatedClips, data.newClip], dirty: true });
      store.recomposite();
      window.api.inkscapeClip(data.newClip.id, data.clipName, data.clipRegSvg);
      window.api.inkscapeDirty();
      // unsubClips subscription handles broadcasting to all editors
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
          clips: state.clips,
        }, {
          canUndo: state.canUndo,
          canRedo: state.canRedo,
          dirty: state.dirty,
          fps: state.fps,
          projectPath: state.projectPath,
        });
      }
    });

    // Subscribe to clips changes and broadcast all clip states to all open editors.
    // This ensures every editor stays aware of sibling clip updates (e.g. clips-within-clips).
    const unsubClips = useProjectStore.subscribe((state, prev) => {
      if (state.clips === prev.clips) return;
      const meta = {
        canUndo: state.canUndo,
        canRedo: state.canRedo,
        dirty: state.dirty,
        fps: state.fps,
        projectPath: state.projectPath,
      };
      for (const clip of state.clips) {
        window.api.broadcastClipState(clip.id, {
          layers: clip.layers,
          width: clip.width,
          height: clip.height,
          totalFrames: clip.totalFrames,
          name: clip.name,
          clips: state.clips,
        }, meta);
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
      cleanupNClip();
      cleanupStateReq();
      unsubClips();
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
