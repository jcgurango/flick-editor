const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File I/O
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
  exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
  readFileAsDataUrl: (filePath) => ipcRenderer.invoke('fs:readFileDataUrl', filePath),

  // Path utilities
  pathJoin: (...segments) => ipcRenderer.invoke('path:join', ...segments),
  dirname: (filePath) => ipcRenderer.invoke('path:dirname', filePath),

  // Dialogs
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:open', options),
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:save', options),

  // Config
  getConfig: (key) => ipcRenderer.invoke('config:get', key),
  setConfig: (key, value) => ipcRenderer.invoke('config:set', key, value),

  // Inkscape pipe mode
  inkscapeLoad: (filename, svgData) => ipcRenderer.invoke('inkscape:load', filename, svgData),
  onInkscapeSaved: (callback) => {
    const listener = (_event, filename, svgContent) => callback(filename, svgContent);
    ipcRenderer.on('inkscape:saved', listener);
    return () => ipcRenderer.removeListener('inkscape:saved', listener);
  },
  onInkscapeWindowClosed: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inkscape:windowClosed', listener);
    return () => ipcRenderer.removeListener('inkscape:windowClosed', listener);
  },
  onInkscapeUndo: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inkscape:undo', listener);
    return () => ipcRenderer.removeListener('inkscape:undo', listener);
  },
  onInkscapeRedo: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inkscape:redo', listener);
    return () => ipcRenderer.removeListener('inkscape:redo', listener);
  },

});
