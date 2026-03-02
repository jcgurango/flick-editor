import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { exportFrame } from '../lib/compositor';

type ExportFormat = 'svg' | 'png';

interface ExportDialogProps {
  onClose: () => void;
}

/** Rasterize an SVG string to a base64-encoded PNG via an offscreen canvas. */
function rasterizeSvgToPngBase64(svg: string, w: number, h: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/png');
      resolve(dataUrl.replace('data:image/png;base64,', ''));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load SVG for rasterization'));
    };
    img.src = url;
  });
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const layers = useProjectStore((s) => s.layers);
  const width = useProjectStore((s) => s.width);
  const height = useProjectStore((s) => s.height);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const background = useProjectStore((s) => s.background);
  const exportPath = useProjectStore((s) => s.exportPath);
  const setExportPath = useProjectStore((s) => s.setExportPath);
  const clips = useProjectStore((s) => s.clips);

  const [format, setFormat] = useState<ExportFormat>('svg');
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
      if (val.format) setFormat(val.format);
      if (val.renderBg !== undefined) setRenderBg(val.renderBg);
      if (val.exportWidth) setExportWidth(val.exportWidth);
      if (val.exportHeight) setExportHeight(val.exportHeight);
    });
  }, []);

  const saveSettings = async () => {
    await window.api.setConfig('exportSettings', {
      format,
      renderBg,
      exportWidth,
      exportHeight,
    });
  };

  const handleBrowse = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Choose export folder',
      defaultPath: exportPath || undefined,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setExportPath(result.filePaths[0]);
  };

  const handleExport = async () => {
    if (!exportPath) return;

    await saveSettings();
    await window.api.mkdir(exportPath);

    setExporting(true);
    setProgress(0);
    cancelRef.current = false;

    const ew = exportWidth ? parseInt(exportWidth, 10) : undefined;
    const eh = exportHeight ? parseInt(exportHeight, 10) : undefined;
    const bg = renderBg ? background : null;
    const outW = ew || width;
    const outH = eh || height;

    for (let f = 0; f < totalFrames; f++) {
      if (cancelRef.current) break;

      const svg = exportFrame(layers, f, width, height, bg, ew, eh, totalFrames, clips);

      if (format === 'png') {
        const base64 = await rasterizeSvgToPngBase64(svg, outW, outH);
        const filename = `frame_${String(f).padStart(4, '0')}.png`;
        await window.api.writeFileBase64(await window.api.pathJoin(exportPath, filename), base64);
      } else {
        const filename = `frame_${String(f).padStart(4, '0')}.svg`;
        await window.api.writeFile(await window.api.pathJoin(exportPath, filename), svg);
      }

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
            <label>Folder</label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                value={exportPath || ''}
                readOnly
                placeholder="No folder selected"
                style={{ flex: 1 }}
                disabled={exporting}
              />
              <button className="dialog-btn" onClick={handleBrowse} disabled={exporting}>
                Browse
              </button>
            </div>
          </div>
          <div className="dialog-field">
            <label>Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
              disabled={exporting}
            >
              <option value="svg">SVG</option>
              <option value="png">PNG</option>
            </select>
          </div>
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
              disabled={!exportPath}
            >
              Export
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
