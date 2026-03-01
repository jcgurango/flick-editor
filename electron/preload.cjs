const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File I/O
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('fs:writeFile', filePath, data),
  mkdir: (dirPath) => ipcRenderer.invoke('fs:mkdir', dirPath),
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

  // Clip management
  inkscapeClip: (clipId, clipName, svgData) => ipcRenderer.invoke('inkscape:clip', clipId, clipName, svgData),
  inkscapeUclip: (clipId) => ipcRenderer.invoke('inkscape:uclip', clipId),
  onInkscapeNClip: (callback) => {
    const listener = (_event, elementId) => callback(elementId);
    ipcRenderer.on('inkscape:nclip', listener);
    return () => ipcRenderer.removeListener('inkscape:nclip', listener);
  },

  // Dirty state sync
  inkscapeDirty: () => ipcRenderer.invoke('inkscape:dirty'),
  inkscapeUndirty: () => ipcRenderer.invoke('inkscape:undirty'),
  onInkscapeRequestSave: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('inkscape:requestSave', listener);
    return () => ipcRenderer.removeListener('inkscape:requestSave', listener);
  },

  // ── Clip Editor IPC ──────────────────────────────────────

  // Open a clip editor window
  openClipEditor: (clipId, title) => ipcRenderer.invoke('clip:openEditor', clipId, title),

  // Clip window → Main window: sync state
  syncClipState: (clipId, clipData) => ipcRenderer.send('clip:syncState', clipId, clipData),

  // Clip window → Main window: request undo/redo/save
  requestClipUndo: (clipId) => ipcRenderer.send('clip:requestUndo', clipId),
  requestClipRedo: (clipId) => ipcRenderer.send('clip:requestRedo', clipId),
  requestClipSave: () => ipcRenderer.send('clip:requestSave'),

  // Clip window: request initial state from main
  requestClipState: (clipId) => ipcRenderer.invoke('clip:requestState', clipId),

  // Clip window: listen for state updates from main
  onClipStateUpdate: (callback) => {
    const listener = (_event, clipData, meta) => callback(clipData, meta);
    ipcRenderer.on('clip:stateUpdate', listener);
    return () => ipcRenderer.removeListener('clip:stateUpdate', listener);
  },

  // Main window → Clip window: broadcast updated state
  broadcastClipState: (clipId, clipData, meta) => ipcRenderer.send('clip:broadcastState', clipId, clipData, meta),

  // Main window: listen for incoming sync from clip windows
  onClipIncomingSync: (callback) => {
    const listener = (_event, clipId, clipData) => callback(clipId, clipData);
    ipcRenderer.on('clip:incomingSync', listener);
    return () => ipcRenderer.removeListener('clip:incomingSync', listener);
  },

  // Main window: listen for undo/redo/save requests from clip windows
  onClipUndoRequest: (callback) => {
    const listener = (_event, clipId) => callback(clipId);
    ipcRenderer.on('clip:undoRequest', listener);
    return () => ipcRenderer.removeListener('clip:undoRequest', listener);
  },
  onClipRedoRequest: (callback) => {
    const listener = (_event, clipId) => callback(clipId);
    ipcRenderer.on('clip:redoRequest', listener);
    return () => ipcRenderer.removeListener('clip:redoRequest', listener);
  },
  onClipSaveRequest: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('clip:saveRequest', listener);
    return () => ipcRenderer.removeListener('clip:saveRequest', listener);
  },

  // Main window: listen for state requests from clip windows
  onClipStateRequest: (callback) => {
    const listener = (_event, clipId) => callback(clipId);
    ipcRenderer.on('clip:stateRequest', listener);
    return () => ipcRenderer.removeListener('clip:stateRequest', listener);
  },

  // Main window → All clip windows: broadcast meta changes
  broadcastClipMetaToAll: (meta) => ipcRenderer.send('clip:broadcastMetaToAll', meta),

  // Clip window: listen for meta-only updates
  onClipMetaUpdate: (callback) => {
    const listener = (_event, meta) => callback(meta);
    ipcRenderer.on('clip:metaUpdate', listener);
    return () => ipcRenderer.removeListener('clip:metaUpdate', listener);
  },
});
