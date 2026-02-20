import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';

interface NewProjectDialogProps {
  onClose: () => void;
}

export function NewProjectDialog({ onClose }: NewProjectDialogProps) {
  const [folder, setFolder] = useState('my-animation');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(24);
  const [frames, setFrames] = useState(60);
  const [saving, setSaving] = useState(false);

  const newProject = useProjectStore((s) => s.newProject);

  const handleCreate = async () => {
    // Ask user where to save
    const result = await window.api.showOpenDialog({
      title: 'Choose save location',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setSaving(true);
    try {
      await newProject({
        folder,
        width,
        height,
        fps,
        totalFrames: frames,
        savePath: result.filePaths[0],
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">New Project</div>
        <div className="dialog-body">
          <div className="dialog-field">
            <label>Folder</label>
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              autoFocus
            />
          </div>
          <div className="dialog-field">
            <label>Width</label>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </div>
          <div className="dialog-field">
            <label>Height</label>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </div>
          <div className="dialog-field">
            <label>FPS</label>
            <input
              type="number"
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
            />
          </div>
          <div className="dialog-field">
            <label>Frames</label>
            <input
              type="number"
              value={frames}
              onChange={(e) => setFrames(Number(e.target.value))}
            />
          </div>
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={handleCreate}
            disabled={saving || !folder.trim()}
          >
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
