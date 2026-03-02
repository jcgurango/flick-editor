export interface ClipData {
  layers: import('../store/projectStore').AnimationLayer[];
  width: number;
  height: number;
  totalFrames: number;
  name: string;
}

export interface ClipMeta {
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  fps: number;
  projectPath: string | null;
}

export interface ElectronAPI {
  // File I/O
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, data: string): Promise<void>;
  writeFileBase64(filePath: string, base64Data: string): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;

  // Path utilities
  pathJoin(...segments: string[]): Promise<string>;
  dirname(filePath: string): Promise<string>;

  // Dialogs
  showOpenDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    properties?: string[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;

  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ canceled: boolean; filePath?: string }>;

  // Config
  getConfig(key?: string): Promise<any>;
  setConfig(key: string, value: any): Promise<void>;

  // Inkscape pipe mode
  inkscapeLoad(filename: string, svgData: string): Promise<void>;
  onInkscapeSaved(callback: (filename: string, svgContent: string) => void): () => void;
  onInkscapeWindowClosed(callback: () => void): () => void;
  onInkscapeUndo(callback: () => void): () => void;
  onInkscapeRedo(callback: () => void): () => void;

  // Clip management
  inkscapeClip(clipId: string, clipName: string, svgData: string): Promise<void>;
  inkscapeUclip(clipId: string): Promise<void>;
  onInkscapeNClip(callback: (elementId: string) => void): () => void;

  // Dirty state sync
  inkscapeDirty(): Promise<void>;
  inkscapeUndirty(): Promise<void>;
  onInkscapeRequestSave(callback: () => void): () => void;

  // ── Clip Editor IPC ──────────────────────────────────────

  openClipEditor(clipId: string, title: string): Promise<void>;
  closeClipEditor(clipId: string): Promise<void>;

  // Clip window → Main
  syncClipState(clipId: string, clipData: ClipData): void;
  requestClipUndo(clipId: string): void;
  requestClipRedo(clipId: string): void;
  requestClipSave(): void;
  requestClipState(clipId: string): Promise<void>;

  // Clip window: listen for state updates
  onClipStateUpdate(callback: (clipData: ClipData, meta: ClipMeta) => void): () => void;

  // Main window → Clip
  broadcastClipState(clipId: string, clipData: ClipData, meta: ClipMeta): void;

  // Main window: listeners
  onClipIncomingSync(callback: (clipId: string, clipData: ClipData) => void): () => void;
  onClipUndoRequest(callback: (clipId: string) => void): () => void;
  onClipRedoRequest(callback: (clipId: string) => void): () => void;
  onClipSaveRequest(callback: () => void): () => void;
  onClipStateRequest(callback: (clipId: string) => void): () => void;

  // Main window → All clip windows: broadcast meta
  broadcastClipMetaToAll(meta: ClipMeta): void;

  // Clip window: listen for meta-only updates
  onClipMetaUpdate(callback: (meta: ClipMeta) => void): () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
