export interface ElectronAPI {
  // File I/O
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, data: string): Promise<void>;
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

}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
