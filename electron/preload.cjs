const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File I/O
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  readdir: (dirPath) => ipcRenderer.invoke('fs:readdir', dirPath),
  rm: (filePath) => ipcRenderer.invoke('fs:rm', filePath),
  rmdir: (dirPath) => ipcRenderer.invoke('fs:rmdir', dirPath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),

  // Path utilities
  pathJoin: (...segments) => ipcRenderer.invoke('path:join', ...segments),
  dirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),

  // Dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:open', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),

  // Config
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),

  // Inkscape
  spawnInkscape: (filePath) => ipcRenderer.invoke('inkscape:spawn', filePath),
  onInkscapeExited: (callback) => {
    const listener = (_event, errorMsg) => callback(errorMsg);
    ipcRenderer.on('inkscape:exited', listener);
    return () => ipcRenderer.removeListener('inkscape:exited', listener);
  },

  // File watching
  watchFile: (filePath) => ipcRenderer.invoke('watch:start', filePath),
  unwatchFile: (filePath) => ipcRenderer.invoke('watch:stop', filePath),
  onFileChanged: (callback) => {
    const listener = (_event, filePath) => callback(filePath);
    ipcRenderer.on('watch:changed', listener);
    return () => ipcRenderer.removeListener('watch:changed', listener);
  },
});
