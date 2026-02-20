export interface ElectronAPI {
  // File I/O
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, data: string): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  readdir(dirPath: string): Promise<string[]>;
  rm(filePath: string): Promise<void>;
  rmdir(dirPath: string): Promise<void>;
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

  // Inkscape
  spawnInkscape(filePath: string): Promise<void>;
  onInkscapeExited(callback: (errorMsg: string | null) => void): () => void;

  // File watching
  watchFile(filePath: string): Promise<void>;
  unwatchFile(filePath: string): Promise<void>;
  onFileChanged(callback: (filePath: string) => void): () => void;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
