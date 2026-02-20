import { useRef, useCallback, useState } from 'react';
import { useProjectStore, selectionRect } from '../store/projectStore';

export function Timeline() {
  const layers = useProjectStore((s) => s.layers);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId);
  const setCurrentFrame = useProjectStore((s) => s.setCurrentFrame);
  const addLayer = useProjectStore((s) => s.addLayer);
  const toggleLayerVisibility = useProjectStore((s) => s.toggleLayerVisibility);
  const toggleLayerLocked = useProjectStore((s) => s.toggleLayerLocked);
  const addKeyframe = useProjectStore((s) => s.addKeyframe);
  const startEditing = useProjectStore((s) => s.startEditing);
  const projectPath = useProjectStore((s) => s.projectPath);
  const editing = useProjectStore((s) => s.editingKeyframe);
  const selection = useProjectStore((s) => s.selection);
  const setSelectionAnchor = useProjectStore((s) => s.setSelectionAnchor);
  const setSelectionEnd = useProjectStore((s) => s.setSelectionEnd);
  const commitSelection = useProjectStore((s) => s.commitSelection);
  const selectLayer = useProjectStore((s) => s.selectLayer);
  const moveLayer = useProjectStore((s) => s.moveLayer);
  const playing = useProjectStore((s) => s.playing);
  const play = useProjectStore((s) => s.play);
  const stop = useProjectStore((s) => s.stop);

  const isEditing = editing !== null;
  const isScrubbing = useRef(false);
  const isDraggingSelection = useRef(false);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Layer drag-reorder state
  const [dragLayerIdx, setDragLayerIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  // 0-indexed frames internally
  const frameIndices = Array.from({ length: totalFrames }, (_, i) => i);

  // Derive the normalized selection rect
  const selRect = selection ? selectionRect(selection) : null;

  const isCellSelected = (layerIdx: number, frame: number): boolean => {
    if (!selRect) return false;
    return (
      layerIdx >= selRect.minLayerIdx &&
      layerIdx <= selRect.maxLayerIdx &&
      frame >= selRect.minFrame &&
      frame <= selRect.maxFrame
    );
  };

  // ── Header scrub ───────────────────────────────────────

  const frameFromHeaderEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const header = headerRef.current;
    if (!header) return -1;
    const rect = header.getBoundingClientRect();
    const x = e.clientX - rect.left + header.scrollLeft;
    const frame = Math.floor(x / 18);
    return Math.max(0, Math.min(totalFrames - 1, frame));
  }, [totalFrames]);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    if (isEditing) return;
    if (playing) stop();
    isScrubbing.current = true;
    const frame = frameFromHeaderEvent(e);
    if (frame >= 0) setCurrentFrame(frame);

    const onMove = (me: MouseEvent) => {
      if (!isScrubbing.current) return;
      const f = frameFromHeaderEvent(me);
      if (f >= 0) setCurrentFrame(f);
    };
    const onUp = () => {
      isScrubbing.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isEditing, playing, stop, frameFromHeaderEvent, setCurrentFrame]);

  // ── Cell selection drag ────────────────────────────────

  const cellFromMouseEvent = useCallback((e: MouseEvent): { layerIdx: number; frame: number } | null => {
    const body = bodyRef.current;
    if (!body) return null;

    const rows = body.querySelectorAll('.timeline-layer-row');
    let layerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const rowRect = rows[i].getBoundingClientRect();
      if (e.clientY >= rowRect.top && e.clientY <= rowRect.bottom) {
        layerIdx = i;
        break;
      }
    }
    if (layerIdx < 0) {
      if (rows.length === 0) return null;
      const firstRect = rows[0].getBoundingClientRect();
      const lastRect = rows[rows.length - 1].getBoundingClientRect();
      if (e.clientY < firstRect.top) layerIdx = 0;
      else if (e.clientY > lastRect.bottom) layerIdx = rows.length - 1;
      else return null;
    }

    const framesEl = rows[layerIdx]?.querySelector('.timeline-layer-frames');
    if (!framesEl) return null;
    const framesRect = framesEl.getBoundingClientRect();
    const x = e.clientX - framesRect.left + framesEl.scrollLeft;
    const frame = Math.floor(x / 18);

    return {
      layerIdx: Math.max(0, Math.min(layers.length - 1, layerIdx)),
      frame: Math.max(0, Math.min(totalFrames - 1, frame)),
    };
  }, [layers.length, totalFrames]);

  const handleCellMouseDown = useCallback((layerIdx: number, frame: number, e: React.MouseEvent) => {
    if (isEditing) return;
    e.stopPropagation();
    e.preventDefault();
    isDraggingSelection.current = true;
    setSelectionAnchor(layerIdx, frame);

    const onMove = (me: MouseEvent) => {
      if (!isDraggingSelection.current) return;
      const cell = cellFromMouseEvent(me);
      if (cell) {
        setSelectionEnd(cell.layerIdx, cell.frame);
      }
    };
    const onUp = () => {
      isDraggingSelection.current = false;
      commitSelection();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isEditing, setSelectionAnchor, setSelectionEnd, commitSelection, cellFromMouseEvent]);

  // ── Layer drag reorder ─────────────────────────────────

  const layerIdxFromMouseEvent = useCallback((e: MouseEvent): number => {
    const body = bodyRef.current;
    if (!body) return 0;
    const rows = body.querySelectorAll('.timeline-layer-row');
    for (let i = 0; i < rows.length; i++) {
      const rowRect = rows[i].getBoundingClientRect();
      const midY = rowRect.top + rowRect.height / 2;
      if (e.clientY < midY) return i;
    }
    return rows.length;
  }, []);

  const handleLayerInfoMouseDown = useCallback((layerIdx: number, e: React.MouseEvent) => {
    if (isEditing) return;
    e.stopPropagation();

    // Select the layer immediately
    selectLayer(layers[layerIdx]?.id ?? null);

    const startY = e.clientY;
    let didDrag = false;
    let currentDropTarget: number | null = null;

    const onMove = (me: MouseEvent) => {
      if (!didDrag && Math.abs(me.clientY - startY) < 4) return;
      didDrag = true;
      setDragLayerIdx(layerIdx);
      const target = layerIdxFromMouseEvent(me);
      currentDropTarget = target;
      setDropTargetIdx(target);
    };

    const onUp = () => {
      if (didDrag && currentDropTarget !== null) {
        const adjustedTarget = currentDropTarget > layerIdx ? currentDropTarget - 1 : currentDropTarget;
        if (adjustedTarget !== layerIdx) {
          moveLayer(layerIdx, adjustedTarget);
        }
      }
      setDragLayerIdx(null);
      setDropTargetIdx(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [isEditing, layers, selectLayer, moveLayer, layerIdxFromMouseEvent]);

  // ── Double-click to edit ────────────────────────────────

  const handleDoubleClickCell = (layerId: string, frame: number) => {
    if (!projectPath || isEditing) return;
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;
    if (layer.keyframes.some((kf) => kf.frame === frame)) {
      startEditing(layerId, frame);
    }
  };

  // ── Keyframe helpers ────────────────────────────────────

  const handleAddKeyframe = (fromReference: boolean) => {
    if (!selectedLayerId || !projectPath || isEditing) return;
    addKeyframe(selectedLayerId, currentFrame, fromReference);
  };

  const hasKeyframe = (layerId: string, frame: number): boolean => {
    const layer = layers.find((l) => l.id === layerId);
    return layer?.keyframes.some((kf) => kf.frame === frame) ?? false;
  };

  return (
    <div className={`timeline-panel ${isEditing ? 'editing-locked' : ''}`}>
      <div className="timeline-header">
        <div className="timeline-layers-header">
          <span>Layers</span>
          <div className="timeline-header-actions">
            {projectPath && (
              <>
                <button
                  className="timeline-add-kf"
                  onClick={() => handleAddKeyframe(true)}
                  title="Add keyframe from nearest reference (F6)"
                  disabled={!selectedLayerId || isEditing}
                >
                  +KF
                </button>
                <button
                  className="timeline-add-kf"
                  onClick={() => handleAddKeyframe(false)}
                  title="Add empty keyframe (F7)"
                  disabled={!selectedLayerId || isEditing}
                >
                  +E
                </button>
              </>
            )}
            <button
              className="timeline-add-layer"
              onClick={() => addLayer()}
              title="Add Layer"
              disabled={isEditing}
            >
              +
            </button>
          </div>
        </div>
        <div
          className="timeline-frames-header"
          ref={headerRef}
          onMouseDown={handleHeaderMouseDown}
        >
          {frameIndices.map((f) => {
            const display = f + 1;
            return (
              <div
                key={f}
                className={`timeline-frame-number ${f === currentFrame ? 'current' : ''}`}
              >
                {display % 5 === 0 || display === 1 ? display : ''}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className="timeline-body"
        ref={bodyRef}
        onScroll={() => {
          if (bodyRef.current && headerRef.current) {
            headerRef.current.scrollLeft = bodyRef.current.scrollLeft;
          }
        }}
      >
        {layers.map((layer, layerIdx) => (
          <div
            key={layer.id}
            className={
              `timeline-layer-row` +
              `${layer.id === selectedLayerId && !selection ? ' selected' : ''}` +
              `${dragLayerIdx === layerIdx ? ' dragging' : ''}`
            }
          >
            {/* Drop indicator line */}
            {dropTargetIdx === layerIdx && dragLayerIdx !== null && dragLayerIdx !== layerIdx && (
              <div className="layer-drop-indicator" />
            )}
            <div
              className="timeline-layer-info"
              onMouseDown={(e) => handleLayerInfoMouseDown(layerIdx, e)}
            >
              <button
                className={`layer-btn ${layer.visible ? '' : 'off'}`}
                onClick={(e) => { e.stopPropagation(); if (!isEditing) toggleLayerVisibility(layer.id); }}
                title={layer.visible ? 'Hide' : 'Show'}
                disabled={isEditing}
              >
                {layer.visible ? '\u25C9' : '\u25CB'}
              </button>
              <button
                className={`layer-btn ${layer.locked ? 'on' : ''}`}
                onClick={(e) => { e.stopPropagation(); if (!isEditing) toggleLayerLocked(layer.id); }}
                title={layer.locked ? 'Unlock' : 'Lock'}
                disabled={isEditing}
              >
                {layer.locked ? '\u25A0' : '\u25A1'}
              </button>
              <span className="layer-name">{layer.id}</span>
            </div>
            <div className="timeline-layer-frames">
              {frameIndices.map((f) => (
                <div
                  key={f}
                  className={
                    `timeline-frame-cell` +
                    `${f === currentFrame ? ' current' : ''}` +
                    `${hasKeyframe(layer.id, f) ? ' has-keyframe' : ''}` +
                    `${isCellSelected(layerIdx, f) ? ' selected-cell' : ''}`
                  }
                  onMouseDown={(e) => handleCellMouseDown(layerIdx, f, e)}
                  onDoubleClick={(e) => { e.stopPropagation(); handleDoubleClickCell(layer.id, f); }}
                >
                  {hasKeyframe(layer.id, f) && (
                    <span className="keyframe-dot" />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {/* Drop indicator at the bottom */}
        {dropTargetIdx === layers.length && dragLayerIdx !== null && (
          <div className="layer-drop-indicator" />
        )}
      </div>
      <div className="timeline-footer">
        <button
          className="playback-btn"
          onClick={() => playing ? stop() : play()}
          disabled={isEditing}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
        >
          {playing ? '\u23F8' : '\u25B6'}
        </button>
        <span className="timeline-frame-display">
          Frame: {currentFrame + 1} / {totalFrames}
        </span>
      </div>
    </div>
  );
}
