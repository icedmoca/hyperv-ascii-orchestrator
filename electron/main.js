const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const PORT = process.env.PORT || 3780;
const DASHBOARD_URL = `http://127.0.0.1:${PORT}/`;

let win;
let serverProcess = null;
let weStartedServer = false;

/** App root: unpacked server/public live here when packaged (asarUnpack). */
function getAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked');
  }
  return path.join(__dirname, '..');
}

function getServerEntry() {
  return path.join(getAppRoot(), 'server', 'index.js');
}

function pingDashboard() {
  return new Promise((resolve) => {
    const req = http.get(DASHBOARD_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    const serverEntry = getServerEntry();
    const appRoot = getAppRoot();
    serverProcess = fork(serverEntry, [], {
      cwd: appRoot,
      env: {
        ...process.env,
        PORT: String(PORT),
        ELECTRON_RUN_AS_NODE: '1',
      },
      silent: false,
      execPath: process.execPath,
    });
    serverProcess.on('error', reject);
    weStartedServer = true;

    let attempts = 40;
    const tick = async () => {
      if (await pingDashboard()) {
        resolve();
        return;
      }
      attempts -= 1;
      if (attempts <= 0) {
        reject(new Error('Server did not become ready on port ' + PORT));
        return;
      }
      setTimeout(tick, 250);
    };
    setTimeout(tick, 400);
  });
}

async function ensureServer() {
  if (await pingDashboard()) return;
  await startEmbeddedServer();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0d1117',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(DASHBOARD_URL);
}

function registerWindowControlsIpc() {
  ipcMain.handle('win-minimize', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w) w.minimize();
  });
  ipcMain.handle('win-maximize', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  ipcMain.handle('win-close', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w) w.close();
  });
}

app.whenReady().then(async () => {
  try {
    await ensureServer();
  } catch (e) {
    console.error(e.message);
    app.quit();
    return;
  }
  registerWindowControlsIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (weStartedServer && serverProcess) {
    try {
      serverProcess.kill();
    } catch (_) {}
    serverProcess = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (weStartedServer && serverProcess) {
    try {
      serverProcess.kill();
    } catch (_) {}
  }
});
