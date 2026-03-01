const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isDev = !app.isPackaged;

// ── Config ────────────────────────────────────────────────

const configPath = path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

let mainWindow = null;

// ── Multi-Inkscape window tracking ────────────────────────

let inkscapeWindowForRenderer = new Map(); // webContents.id → inkscapeWindowId
let rendererForInkscapeWindow = new Map(); // inkscapeWindowId → webContents.id
let pendingOpens = [];                     // queue of { rendererId, resolve }
let allRendererWindows = new Map();        // webContents.id → BrowserWindow

// ── Clip editor windows ───────────────────────────────────

let clipEditorWindows = new Map(); // clipId → BrowserWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Flick Editor',
    icon: path.join(__dirname, '..', 'public', 'FlickIcon.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  const mainRendererId = mainWindow.webContents.id;
  allRendererWindows.set(mainRendererId, mainWindow);

  mainWindow.on('closed', () => {
    // Close all clip editor windows
    for (const [, win] of clipEditorWindows) {
      if (!win.isDestroyed()) win.close();
    }
    clipEditorWindows.clear();
    allRendererWindows.delete(mainRendererId);
    mainWindow = null;
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

// ── File I/O ──────────────────────────────────────────────

ipcMain.handle('fs:readFile', async (_event, filePath) => {
  return fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('fs:writeFile', async (_event, filePath, data) => {
  await fs.promises.writeFile(filePath, data, 'utf-8');
});

ipcMain.handle('fs:mkdir', async (_event, dirPath) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
});

ipcMain.handle('fs:exists', async (_event, filePath) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

// ── Path utilities ────────────────────────────────────────

ipcMain.handle('path:join', (_event, ...segments) => {
  return path.join(...segments);
});

ipcMain.handle('path:dirname', (_event, filePath) => {
  return path.dirname(filePath);
});

// ── Dialogs ───────────────────────────────────────────────

ipcMain.handle('dialog:open', async (_event, options) => {
  const senderWin = BrowserWindow.fromWebContents(_event.sender);
  return dialog.showOpenDialog(senderWin || mainWindow, options);
});

ipcMain.handle('dialog:save', async (_event, options) => {
  const senderWin = BrowserWindow.fromWebContents(_event.sender);
  return dialog.showSaveDialog(senderWin || mainWindow, options);
});

// ── Config ────────────────────────────────────────────────

ipcMain.handle('config:get', async (_event, key) => {
  const config = readConfig();
  return key ? config[key] : config;
});

ipcMain.handle('config:set', async (_event, key, value) => {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
});

// ── Inkscape Pipe Mode ────────────────────────────────────

let inkscapeProc = null;

/** Find the BrowserWindow for a given webContents.id */
function findWindowForRenderer(rendererId) {
  const win = allRendererWindows.get(rendererId);
  if (win && !win.isDestroyed()) return win;
  return null;
}

function parseInkscapeStdout(stream) {
  let buffer = '';
  let expecting = null;

  stream.on('data', (chunk) => {
    process.stdout.write(`[ink stdout] ${chunk}`);
    buffer += chunk.toString();

    while (true) {
      if (!expecting) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;

        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);

        // OPEN <id>
        const openMatch = line.match(/^OPEN (\d+)$/);
        if (openMatch) {
          const id = parseInt(openMatch[1]);
          if (pendingOpens.length > 0) {
            const pending = pendingOpens.shift();
            inkscapeWindowForRenderer.set(pending.rendererId, id);
            rendererForInkscapeWindow.set(id, pending.rendererId);
            pending.resolve(id);
          }
          continue;
        }

        // CLOSE <id>
        const closeMatch = line.match(/^CLOSE (\d+)$/);
        if (closeMatch) {
          const id = parseInt(closeMatch[1]);
          const rendererId = rendererForInkscapeWindow.get(id);
          if (rendererId !== undefined) {
            inkscapeWindowForRenderer.delete(rendererId);
            rendererForInkscapeWindow.delete(id);
            const win = findWindowForRenderer(rendererId);
            if (win) {
              win.webContents.send('inkscape:windowClosed');
            }
          }
          continue;
        }

        // REQUESTSAVE <id>
        const requestSaveMatch = line.match(/^REQUESTSAVE (\d+)$/);
        if (requestSaveMatch) {
          const id = parseInt(requestSaveMatch[1]);
          const rendererId = rendererForInkscapeWindow.get(id);
          if (rendererId !== undefined) {
            const win = findWindowForRenderer(rendererId);
            if (win) win.webContents.send('inkscape:requestSave');
          }
          continue;
        }

        // NCLIP <element-id>
        const nclipMatch = line.match(/^NCLIP (.+)$/);
        if (nclipMatch) {
          // NCLIP doesn't include a window ID; route to the most recently
          // active renderer that has an Inkscape window open.
          // In practice, NCLIP follows a SAVE which sets `expecting`, so we
          // can't easily know which window triggered it. Forward to all
          // renderers that have an Inkscape window.
          // Actually, NCLIP always follows the last SAVE. We track that.
          if (lastSaveRendererId !== undefined) {
            const win = findWindowForRenderer(lastSaveRendererId);
            if (win) win.webContents.send('inkscape:nclip', nclipMatch[1]);
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inkscape:nclip', nclipMatch[1]);
          }
          continue;
        }

        // UNDO <id>
        const undoMatch = line.match(/^UNDO (\d+)$/);
        if (undoMatch) {
          const id = parseInt(undoMatch[1]);
          const rendererId = rendererForInkscapeWindow.get(id);
          if (rendererId !== undefined) {
            const win = findWindowForRenderer(rendererId);
            if (win) win.webContents.send('inkscape:undo');
          }
          continue;
        }

        // REDO <id>
        const redoMatch = line.match(/^REDO (\d+)$/);
        if (redoMatch) {
          const id = parseInt(redoMatch[1]);
          const rendererId = rendererForInkscapeWindow.get(id);
          if (rendererId !== undefined) {
            const win = findWindowForRenderer(rendererId);
            if (win) win.webContents.send('inkscape:redo');
          }
          continue;
        }

        // SAVE <id> content-length:<N>
        const saveMatch = line.match(/^SAVE (\d+) content-length:(\d+)$/);
        if (saveMatch) {
          expecting = {
            windowId: parseInt(saveMatch[1]),
            contentLength: parseInt(saveMatch[2]),
            filename: null,
          };
          continue;
        }

        continue;
      }

      // Reading filename line
      if (expecting.filename === null) {
        const lineEnd = buffer.indexOf('\n');
        if (lineEnd === -1) break;
        expecting.filename = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 1);
      }

      // Reading SVG content
      const available = Buffer.byteLength(buffer, 'utf-8');
      if (available < expecting.contentLength) break;

      const buf = Buffer.from(buffer, 'utf-8');
      const content = buf.subarray(0, expecting.contentLength).toString('utf-8');
      buffer = buf.subarray(expecting.contentLength).toString('utf-8');

      const rendererId = rendererForInkscapeWindow.get(expecting.windowId);
      lastSaveRendererId = rendererId;
      if (rendererId !== undefined) {
        const win = findWindowForRenderer(rendererId);
        if (win) {
          win.webContents.send('inkscape:saved', expecting.filename, content);
        }
      }
      expecting = null;
    }
  });
}

// Track which renderer received the last SAVE (for NCLIP routing)
let lastSaveRendererId = undefined;

function ensureInkscape() {
  return new Promise((resolve, reject) => {
    if (inkscapeProc && !inkscapeProc.killed) {
      resolve();
      return;
    }

    const config = readConfig();
    const devInkscape = path.join(__dirname, '..', 'inkscape', 'build', 'install_dir', 'bin', 'inkscape.exe');
    const customPath = config.inkscapePath && config.inkscapePath.trim();
    const bin = customPath || (isDev ? devInkscape : 'inkscape');

    console.log(`[ink] Starting: ${bin} --pipe-mode --delegate-undo-stack`);
    const proc = spawn(bin, ['--pipe-mode', '--delegate-undo-stack'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    inkscapeProc = proc;
    inkscapeWindowForRenderer.clear();
    rendererForInkscapeWindow.clear();
    let started = false;

    proc.on('error', (err) => {
      inkscapeProc = null;
      if (!started) {
        started = true;
        reject(err);
      }
    });

    proc.on('spawn', () => {
      started = true;
      parseInkscapeStdout(proc.stdout);
      proc.stderr.on('data', (d) => { process.stderr.write(`[ink stderr] ${d}`); });
      resolve();
    });

    proc.on('exit', () => {
      inkscapeProc = null;
      // Notify all renderers that had Inkscape windows
      for (const [rendererId] of inkscapeWindowForRenderer) {
        const win = findWindowForRenderer(rendererId);
        if (win) win.webContents.send('inkscape:windowClosed');
      }
      inkscapeWindowForRenderer.clear();
      rendererForInkscapeWindow.clear();
    });
  });
}

function openInkscapeWindow(rendererId) {
  return new Promise((resolve) => {
    pendingOpens.push({ rendererId, resolve });
    console.log('[ink stdin] OPEN');
    inkscapeProc.stdin.write('OPEN\n');
  });
}

// IPC: load SVG into Inkscape (starts process + opens window if needed)
ipcMain.handle('inkscape:load', async (_event, filename, svgData) => {
  await ensureInkscape();

  const rendererId = _event.sender.id;

  if (!inkscapeWindowForRenderer.has(rendererId)) {
    await openInkscapeWindow(rendererId);
  }

  const inkId = inkscapeWindowForRenderer.get(rendererId);
  const buf = Buffer.from(svgData, 'utf-8');
  const header = `LOAD ${inkId} content-length:${buf.length}\n${filename}\n`;
  console.log(`[ink stdin] LOAD ${inkId} content-length:${buf.length} filename:${filename}`);
  console.log(`[ink stdin] ${svgData}`);
  inkscapeProc.stdin.write(header);
  inkscapeProc.stdin.write(buf);
});

ipcMain.handle('inkscape:clip', async (_event, clipId, clipName, svgData) => {
  if (!inkscapeProc || inkscapeProc.killed) return;
  const svgBuf = Buffer.from(svgData, 'utf-8');
  inkscapeProc.stdin.write(`CLIP ${clipId} content-length:${svgBuf.length}\n${clipName}\n`);
  inkscapeProc.stdin.write(svgBuf);
});

ipcMain.handle('inkscape:uclip', async (_event, clipId) => {
  if (!inkscapeProc || inkscapeProc.killed) return;
  inkscapeProc.stdin.write(`UCLIP ${clipId}\n`);
});

ipcMain.handle('inkscape:dirty', async () => {
  if (!inkscapeProc || inkscapeProc.killed) return;
  for (const inkId of rendererForInkscapeWindow.keys()) {
    inkscapeProc.stdin.write(`DIRTY ${inkId}\n`);
  }
});

ipcMain.handle('inkscape:undirty', async () => {
  if (!inkscapeProc || inkscapeProc.killed) return;
  for (const inkId of rendererForInkscapeWindow.keys()) {
    inkscapeProc.stdin.write(`UNDIRTY ${inkId}\n`);
  }
});

// ── Clip Editor Window Management ─────────────────────────

ipcMain.handle('clip:openEditor', (_event, clipId, title) => {
  if (clipEditorWindows.has(clipId)) {
    const existing = clipEditorWindows.get(clipId);
    if (!existing.isDestroyed()) {
      existing.focus();
      return;
    }
    clipEditorWindows.delete(clipId);
  }

  let url;
  if (isDev) {
    url = `http://localhost:5173?clipId=${clipId}`;
  } else {
    url = `file://${path.join(__dirname, '..', 'dist', 'index.html').replace(/\\/g, '/')}?clipId=${clipId}`;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: title || `Clip Editor — ${clipId}`,
    icon: path.join(__dirname, '..', 'public', 'FlickIcon.svg'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(url);
  const clipRendererId = win.webContents.id;
  clipEditorWindows.set(clipId, win);
  allRendererWindows.set(clipRendererId, win);

  win.on('closed', () => {
    clipEditorWindows.delete(clipId);
    allRendererWindows.delete(clipRendererId);
    // Clean up Inkscape window mapping
    const inkId = inkscapeWindowForRenderer.get(clipRendererId);
    if (inkId !== undefined) {
      inkscapeWindowForRenderer.delete(clipRendererId);
      rendererForInkscapeWindow.delete(inkId);
    }
  });
});

// ── Inter-Window IPC (Clip ↔ Main) ────────────────────────

// Clip window → Main: sync clip state
ipcMain.on('clip:syncState', (_event, clipId, clipData) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clip:incomingSync', clipId, clipData);
  }
});

// Clip window → Main: request undo
ipcMain.on('clip:requestUndo', (_event, clipId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clip:undoRequest', clipId);
  }
});

// Clip window → Main: request redo
ipcMain.on('clip:requestRedo', (_event, clipId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clip:redoRequest', clipId);
  }
});

// Clip window → Main: request save
ipcMain.on('clip:requestSave', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clip:saveRequest');
  }
});

// Clip window requests initial state from main
ipcMain.handle('clip:requestState', (_event, clipId) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('clip:stateRequest', clipId, _event.sender.id);
  }
  // The actual response is sent asynchronously via clip:broadcastState
});

// Main window → Clip: broadcast updated clip state
ipcMain.on('clip:broadcastState', (_event, clipId, clipData, meta) => {
  const win = clipEditorWindows.get(clipId);
  if (win && !win.isDestroyed()) {
    win.webContents.send('clip:stateUpdate', clipData, meta);
  }
});

// Main window → All clip windows: broadcast meta-only update (dirty, fps, etc.)
ipcMain.on('clip:broadcastMetaToAll', (_event, meta) => {
  for (const [, win] of clipEditorWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send('clip:metaUpdate', meta);
    }
  }
});

// ── App lifecycle ─────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Kill Inkscape pipe-mode process
  if (inkscapeProc && !inkscapeProc.killed) {
    inkscapeProc.stdin.end();
    inkscapeProc.kill();
    inkscapeProc = null;
  }
  inkscapeWindowForRenderer.clear();
  rendererForInkscapeWindow.clear();

  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Start inkscape in the background so it doesn't take long to startup
ensureInkscape();
