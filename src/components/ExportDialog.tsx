import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { exportFrame } from '../lib/compositor';

interface ExportDialogProps {
  onClose: () => void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const layers = useProjectStore((s) => s.layers);
  const width = useProjectStore((s) => s.width);
  const height = useProjectStore((s) => s.height);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const background = useProjectStore((s) => s.background);
  const projectPath = useProjectStore((s) => s.projectPath);

  const [renderBg, setRenderBg] = useState(true);
  const [exportWidth, setExportWidth] = useState('');
  const [exportHeight, setExportHeight] = useState('');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);

  // Load saved export settings from config
  useEffect(() => {
    window.api.getConfig('exportSettings').then((val: any) => {
      if (!val) return;
      if (val.renderBg !== undefined) setRenderBg(val.renderBg);
      if (val.exportWidth) setExportWidth(val.exportWidth);
      if (val.exportHeight) setExportHeight(val.exportHeight);
    });
  }, []);

  const saveSettings = async () => {
    await window.api.setConfig('exportSettings', {
      renderBg,
      exportWidth,
      exportHeight,
    });
  };

  const handleExport = async () => {
    if (!projectPath) return;
    const api = window.api;

    await saveSettings();

    const exportDir = await api.pathJoin(projectPath, 'export');
    await api.mkdir(exportDir);

    setExporting(true);
    setProgress(0);
    cancelRef.current = false;

    const ew = exportWidth ? parseInt(exportWidth, 10) : undefined;
    const eh = exportHeight ? parseInt(exportHeight, 10) : undefined;
    const bg = renderBg ? background : null;

    for (let f = 0; f < totalFrames; f++) {
      if (cancelRef.current) break;

      const svg = exportFrame(layers, f, width, height, bg, ew, eh);
      const filename = `frame_${String(f).padStart(4, '0')}.svg`;
      await api.writeFile(await api.pathJoin(exportDir, filename), svg);

      setProgress(f + 1);
      // Yield to UI
      await new Promise((r) => setTimeout(r, 0));
    }

    setExporting(false);
    if (!cancelRef.current) onClose();
  };

  const handleCancel = () => {
    if (exporting) {
      cancelRef.current = true;
    } else {
      onClose();
    }
  };

  const pct = totalFrames > 0 ? Math.round((progress / totalFrames) * 100) : 0;

  return (
    <div className="dialog-overlay" onClick={exporting ? undefined : onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">Export Frames</div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label>Background</label>
            <select
              value={renderBg ? 'yes' : 'no'}
              onChange={(e) => setRenderBg(e.target.value === 'yes')}
              disabled={exporting}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </div>
          <div className="dialog-field">
            <label>Width</label>
            <input
              type="number"
              value={exportWidth}
              onChange={(e) => setExportWidth(e.target.value)}
              placeholder={String(width)}
              disabled={exporting}
            />
          </div>
          <div className="dialog-field">
            <label>Height</label>
            <input
              type="number"
              value={exportHeight}
              onChange={(e) => setExportHeight(e.target.value)}
              placeholder={String(height)}
              disabled={exporting}
            />
          </div>

          {exporting && (
            <div className="export-progress">
              <div className="export-progress-bar">
                <div className="export-progress-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="export-progress-text">
                {progress} / {totalFrames} ({pct}%)
              </span>
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={handleCancel}>
            {exporting ? 'Cancel' : 'Close'}
          </button>
          {!exporting && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleExport}
              disabled={!projectPath}
            >
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
