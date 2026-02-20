import { useState, useEffect, useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { TweenType, EasingDirection, BackgroundType } from '../store/projectStore';

/** Small inline numeric input that commits on blur or Enter */
function NumField({ label, value, onChange, min }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);

  // Sync draft when store value changes externally
  useEffect(() => { setDraft(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= (min ?? 1)) {
      onChange(n);
    } else {
      setDraft(String(value));
    }
  };

  return (
    <div className="inspector-field">
      <label>{label}</label>
      <input
        ref={ref}
        className="inspector-input"
        type="number"
        value={draft}
        min={min ?? 1}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') ref.current?.blur(); }}
      />
    </div>
  );
}

export function Inspector() {
  const width = useProjectStore((s) => s.width);
  const height = useProjectStore((s) => s.height);
  const fps = useProjectStore((s) => s.fps);
  const zoom = useProjectStore((s) => s.canvasZoom);
  const totalFrames = useProjectStore((s) => s.totalFrames);
  const selectedLayerId = useProjectStore((s) => s.selectedLayerId);
  const layers = useProjectStore((s) => s.layers);
  const projectPath = useProjectStore((s) => s.projectPath);
  const editingKeyframe = useProjectStore((s) => s.editingKeyframe);
  const stopEditing = useProjectStore((s) => s.stopEditing);
  const setProjectDimensions = useProjectStore((s) => s.setProjectDimensions);
  const setFps = useProjectStore((s) => s.setFps);
  const setTotalFrames = useProjectStore((s) => s.setTotalFrames);
  const currentFrame = useProjectStore((s) => s.currentFrame);
  const setKeyframeTween = useProjectStore((s) => s.setKeyframeTween);
  const setKeyframeEasing = useProjectStore((s) => s.setKeyframeEasing);
  const background = useProjectStore((s) => s.background);
  const setBackground = useProjectStore((s) => s.setBackground);

  const selectedLayer = layers.find((l) => l.id === selectedLayerId);
  const currentKeyframe = selectedLayer?.keyframes.find((kf) => kf.frame === currentFrame) ?? null;

  // Preferences
  const [inkscapePath, setInkscapePath] = useState<string>('');

  useEffect(() => {
    window.api.getConfig('inkscapePath').then((val: string | undefined) => {
      setInkscapePath(val || '');
    });
  }, []);

  const browseBackgroundImage = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Choose background image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'bmp'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const dataUrl = await window.api.readFileAsDataUrl(result.filePaths[0]);
    setBackground({ imageData: dataUrl });
  };

  const browseInkscape = async () => {
    const result = await window.api.showOpenDialog({
      title: 'Locate Inkscape executable',
      filters: [{ name: 'Executable', extensions: ['exe', ''] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const chosen = result.filePaths[0];
    await window.api.setConfig('inkscapePath', chosen);
    setInkscapePath(chosen);
  };

  return (
    <div className="inspector-panel">
      <div className="inspector-section">
        <div className="inspector-section-title">Project</div>
        <NumField label="Width" value={width} onChange={(v) => setProjectDimensions(v, height)} min={1} />
        <NumField label="Height" value={height} onChange={(v) => setProjectDimensions(width, v)} min={1} />
        <NumField label="FPS" value={fps} onChange={setFps} min={1} />
        <NumField label="Frames" value={totalFrames} onChange={setTotalFrames} min={1} />
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">Background</div>
        <div className="inspector-field">
          <label>Type</label>
          <select
            className="inspector-select"
            value={background.type}
            onChange={(e) => setBackground({ type: e.target.value as BackgroundType })}
          >
            <option value="none">None</option>
            <option value="solid">Solid Color</option>
            <option value="image">Image</option>
          </select>
        </div>
        {background.type === 'solid' && (
          <div className="inspector-field">
            <label>Color</label>
            <input
              className="inspector-color"
              type="color"
              value={background.color}
              onChange={(e) => setBackground({ color: e.target.value })}
            />
          </div>
        )}
        {background.type === 'image' && (
          <div className="inspector-field-col">
            <label>Image</label>
            <div className="inspector-path-row">
              <span className="inspector-path-value">
                {background.imageData ? '(embedded)' : '(none)'}
              </span>
              <button className="inspector-browse-btn" onClick={browseBackgroundImage}>
                ...
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="inspector-section">
        <div className="inspector-section-title">View</div>
        <div className="inspector-field">
          <label>Zoom</label>
          <span className="inspector-value">{Math.round(zoom * 100)}%</span>
        </div>
      </div>

      {selectedLayer && (
        <div className="inspector-section">
          <div className="inspector-section-title">Layer</div>
          <div className="inspector-field">
            <label>ID</label>
            <span className="inspector-value">{selectedLayer.id}</span>
          </div>
          <div className="inspector-field">
            <label>Keyframes</label>
            <span className="inspector-value">{selectedLayer.keyframes.length}</span>
          </div>
        </div>
      )}

      {selectedLayer && currentKeyframe && selectedLayerId && (
        <div className="inspector-section">
          <div className="inspector-section-title">Keyframe</div>
          <div className="inspector-field">
            <label>Tween</label>
            <select
              className="inspector-select"
              value={currentKeyframe.tween}
              onChange={(e) => setKeyframeTween(selectedLayerId, currentFrame, e.target.value as TweenType)}
            >
              <option value="discrete">Discrete</option>
              <option value="linear">Linear</option>
              <option value="quadratic">Quadratic</option>
              <option value="cubic">Cubic</option>
              <option value="exponential">Exponential</option>
              <option value="circular">Circular</option>
              <option value="elastic">Elastic</option>
              <option value="bounce">Bounce</option>
            </select>
          </div>
          <div className="inspector-field">
            <label>Easing</label>
            <select
              className="inspector-select"
              value={currentKeyframe.easing}
              onChange={(e) => setKeyframeEasing(selectedLayerId, currentFrame, e.target.value as EasingDirection)}
              disabled={currentKeyframe.tween === 'discrete' || currentKeyframe.tween === 'linear'}
            >
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="in-out">In-Out</option>
            </select>
          </div>
        </div>
      )}

      {editingKeyframe && (
        <div className="inspector-section">
          <div className="inspector-section-title">Editing</div>
          <div className="inspector-field">
            <label>Layer</label>
            <span className="inspector-value">{editingKeyframe.layerId}</span>
          </div>
          <div className="inspector-field">
            <label>Frame</label>
            <span className="inspector-value">{editingKeyframe.frame + 1}</span>
          </div>
          <button className="inspector-stop-btn" onClick={stopEditing}>
            Stop Editing
          </button>
        </div>
      )}

      <div className="inspector-section">
        <div className="inspector-section-title">Preferences</div>
        <div className="inspector-field-col">
          <label>Inkscape</label>
          <div className="inspector-path-row">
            <span className="inspector-path-value" title={inkscapePath}>
              {inkscapePath || '(auto)'}
            </span>
            <button className="inspector-browse-btn" onClick={browseInkscape}>
              ...
            </button>
          </div>
        </div>
      </div>

      {!projectPath && (
        <div className="inspector-section">
          <div className="inspector-empty">
            No project open.<br />
            Use File &gt; New Project or File &gt; Open.
          </div>
        </div>
      )}
    </div>
  );
}
