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

// ── Inkscape ──────────────────────────────────────────────

let inkscapeChild = null;

ipcMain.handle('inkscape:spawn', (_event, filePath) => {
  return new Promise((resolve, reject) => {
    const config = readConfig();
    const inkscapeBin = config.inkscapePath || 'inkscape';
    let settled = false;

    const child = spawn(inkscapeBin, [filePath], {
      stdio: 'ignore',
    });

    inkscapeChild = child;

    child.on('error', (err) => {
      inkscapeChild = null;
      if (!settled) {
        settled = true;
        reject(err);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('inkscape:exited', err.message);
      }
    });

    child.on('spawn', () => {
      // Process started successfully — detach and resolve
      child.unref();
      if (!settled) {
        settled = true;
        resolve(undefined);
      }
    });

    child.on('exit', () => {
      inkscapeChild = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('inkscape:exited', null);
      }
    });
  });
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

  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
