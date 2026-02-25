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

// Track active file watchers: filePath -> fs.FSWatcher
const watchers = new Map();
let mainWindow = null;

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
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Remove default menu bar — we use our own in-app menus
  Menu.setApplicationMenu(null);

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

ipcMain.handle('fs:readdir', async (_event, dirPath) => {
  return fs.promises.readdir(dirPath);
});

ipcMain.handle('fs:rm', async (_event, filePath) => {
  await fs.promises.unlink(filePath);
});

ipcMain.handle('fs:rmdir', async (_event, dirPath) => {
  await fs.promises.rm(dirPath, { recursive: true, force: true });
});

ipcMain.handle('fs:readFileDataUrl', async (_event, filePath) => {
  const buf = await fs.promises.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' };
  const mime = mimeMap[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
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
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('dialog:save', async (_event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
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
let inkscapeWindowId = null;
let pendingOpenResolve = null;

function parseInkscapeStdout(stream) {
  let buffer = '';
  let expecting = null; // { windowId, contentLength, filename }

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
          inkscapeWindowId = id;
          if (pendingOpenResolve) {
            pendingOpenResolve(id);
            pendingOpenResolve = null;
          }
          continue;
        }

        // CLOSE <id>  (user closed the window)
        const closeMatch = line.match(/^CLOSE (\d+)$/);
        if (closeMatch) {
          const id = parseInt(closeMatch[1]);
          if (inkscapeWindowId === id) {
            inkscapeWindowId = null;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inkscape:windowClosed');
          }
          continue;
        }

        // UNDO <id>
        const undoMatch = line.match(/^UNDO (\d+)$/);
        if (undoMatch) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inkscape:undo');
          }
          continue;
        }

        // REDO <id>
        const redoMatch = line.match(/^REDO (\d+)$/);
        if (redoMatch) {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('inkscape:redo');
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

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('inkscape:saved', expecting.filename, content);
      }
      expecting = null;
    }
  });
}

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
    inkscapeWindowId = null;
    let started = false;

    proc.on('error', (err) => {
      inkscapeProc = null;
      inkscapeWindowId = null;
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
      inkscapeWindowId = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('inkscape:windowClosed');
      }
    });
  });
}

function openInkscapeWindow() {
  return new Promise((resolve) => {
    pendingOpenResolve = resolve;
    console.log('[ink stdin] OPEN');
    inkscapeProc.stdin.write('OPEN\n');
  });
}

// IPC: load SVG into Inkscape (starts process + opens window if needed)
ipcMain.handle('inkscape:load', async (_event, filename, svgData) => {
  await ensureInkscape();

  if (!inkscapeWindowId) {
    await openInkscapeWindow();
  }

  const buf = Buffer.from(svgData, 'utf-8');
  const header = `LOAD ${inkscapeWindowId} content-length:${buf.length}\n${filename}\n`;
  console.log(`[ink stdin] LOAD ${inkscapeWindowId} content-length:${buf.length} filename:${filename}`);
  console.log(`[ink stdin] ${svgData}`);
  inkscapeProc.stdin.write(header);
  inkscapeProc.stdin.write(buf);
});

// ── File Watching ─────────────────────────────────────────

ipcMain.handle('watch:start', async (_event, filePath) => {
  // Don't double-watch
  if (watchers.has(filePath)) return;

  let debounceTimer = null;
  const watcher = fs.watch(filePath, () => {
    // 200ms debounce
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('watch:changed', filePath);
      }
    }, 200);
  });

  watchers.set(filePath, watcher);
});

ipcMain.handle('watch:stop', async (_event, filePath) => {
  const watcher = watchers.get(filePath);
  if (watcher) {
    watcher.close();
    watchers.delete(filePath);
  }
});

// ── App lifecycle ─────────────────────────────────────────

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Clean up all watchers
  for (const watcher of watchers.values()) {
    watcher.close();
  }
  watchers.clear();

  // Kill Inkscape pipe-mode process
  if (inkscapeProc && !inkscapeProc.killed) {
    inkscapeProc.stdin.end();
    inkscapeProc.kill();
    inkscapeProc = null;
    inkscapeWindowId = null;
  }

  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Start inkscape in the background so it doesn't take long to startup
ensureInkscape();