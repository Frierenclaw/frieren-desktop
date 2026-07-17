import { app, BrowserWindow, Tray, Menu, screen, dialog, ipcMain, nativeImage, protocol, net } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';
import { downloadAndExtractAnimations } from './animation-archive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'frieren-asset',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function registerAssetProtocol() {
  protocol.handle('frieren-asset', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);

    if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    return net.fetch(`file://${filePath}`);
  });
}

const DIST_DIR = path.join(__dirname, '..', 'dist');

const windows = new Map();
const stores = new Map();

let tray = null;
let isPassive = false;

const CONTAINER_MARGIN    = 240;
const DEFAULT_CONTAINER_W = 280;
const DEFAULT_CONTAINER_H = 480;

function loadWindowUrlOrFile(win, entry) {
  if (isDev) {
    win.loadURL(`http://localhost:1420/${entry}`);
  } else {
    win.loadFile(path.join(DIST_DIR, entry));
  }
}

function createMainWindow() {
  const width  = DEFAULT_CONTAINER_W + CONTAINER_MARGIN * 2;
  const height = DEFAULT_CONTAINER_H + CONTAINER_MARGIN * 2;
  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + (display.workArea.width  - width)  / 2);
  const y = Math.round(display.workArea.y + (display.workArea.height - height) / 2);

  const win = new BrowserWindow({
    x, y, width, height,
    minWidth: 200,
    minHeight: 300,
    resizable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    show: true,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  loadWindowUrlOrFile(win, 'index.html');
  windows.set('main', win);

  win.on('closed', () => windows.delete('main'));
  return win;
}

function createUiWindow() {
  const existing = windows.get('ui');
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const win = new BrowserWindow({
    width: 460,
    height: 580,
    minWidth: 360,
    minHeight: 480,
    resizable: true,
    frame: true,
    alwaysOnTop: false,
    center: true,
    title: 'Frieren Desktop, Settings',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadWindowUrlOrFile(win, 'ui.html');
  windows.set('ui', win);
  win.on('closed', () => windows.delete('ui'));
  return win;
}

function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'icons', '32x32.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Frieren Desktop');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Avatar',
      click: () => {
        const win = windows.get('main');
        if (win) { win.show(); win.focus(); }
      },
    },
    { label: 'Settings...', click: () => createUiWindow() },
    {
      label: 'Toggle Passive Mode',
      click: () => {
        isPassive = !isPassive;
        windows.get('main')?.webContents.send('frieren-event', {
          event: 'frieren:toggle-passive',
          payload: {},
        });
      },
    },
    { label: 'Recenter Avatar', click: () => recenterMainWindowIfOffscreen() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);

  tray.on('click', () => {
    const win = windows.get('main');
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });
}

function recenterMainWindowIfOffscreen() {
  const win = windows.get('main');
  if (!win) return;

  const bounds = win.getBounds();
  const isOnScreen = screen.getAllDisplays().some((d) => {
    const r = d.workArea;
    return bounds.x + bounds.width  > r.x && bounds.x < r.x + r.width
        && bounds.y + bounds.height > r.y && bounds.y < r.y + r.height;
  });
  if (isOnScreen) return;

  const display = screen.getPrimaryDisplay();
  const x = Math.round(display.workArea.x + (display.workArea.width  - bounds.width)  / 2);
  const y = Math.round(display.workArea.y + (display.workArea.height - bounds.height) / 2);
  win.setBounds({ ...bounds, x, y });
}

ipcMain.handle('get-cursor-position', () => {
  const { x, y } = screen.getCursorScreenPoint();
  return { x, y };
});

ipcMain.handle('set-ignore-cursor-events', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options = process.platform === 'linux' ? undefined : { forward: true };
  win?.setIgnoreMouseEvents(!!ignore, options);
});

ipcMain.handle('get-window-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const [x, y] = win?.getPosition() ?? [0, 0];
  return { x, y };
});

ipcMain.handle('move-window-by', (event, { dx, dy }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const b = win.getBounds();
  win.setBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
});

ipcMain.handle('resize-window-centered', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const b  = win.getBounds();
  const cx = b.x + b.width  / 2;
  const cy = b.y + b.height / 2;
  const nw = Math.round(width);
  const nh = Math.round(height);
  win.setBounds({
    x: Math.round(cx - nw / 2),
    y: Math.round(cy - nh / 2),
    width:  nw,
    height: nh,
  });
});

ipcMain.handle('center-window', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const display = screen.getDisplayMatching(win.getBounds());
  const nw = Math.round(width);
  const nh = Math.round(height);
  const x  = Math.round(display.workArea.x + (display.workArea.width  - nw) / 2);
  const y  = Math.round(display.workArea.y + (display.workArea.height - nh) / 2);
  win.setBounds({ x, y, width: nw, height: nh });
});

ipcMain.handle('open-ui-window', () => { createUiWindow(); });

ipcMain.on('frieren-emit', (_event, { event: evtName, payload, target }) => {
  if (target) {
    windows.get(target)?.webContents.send('frieren-event', { event: evtName, payload });
  } else {
    for (const win of windows.values()) {
      win.webContents.send('frieren-event', { event: evtName, payload });
    }
  }
});

function getStore(fileName) {
  if (!stores.has(fileName)) {
    stores.set(fileName, new Store({ name: fileName.replace(/\.json$/, '') }));
  }
  return stores.get(fileName);
}

ipcMain.handle('store-get', (_event, { file, key }) => getStore(file).get(key) ?? null);
ipcMain.handle('store-set', (_event, { file, key, value }) => { getStore(file).set(key, value); });
ipcMain.handle('store-delete', (_event, { file, key }) => { getStore(file).delete(key); });

ipcMain.handle('dialog-open', async (event, { title, filters, multiple }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title,
    filters,
    properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return multiple ? result.filePaths : result.filePaths[0];
});

ipcMain.handle('app-exit', (_event, code) => { app.exit(code ?? 0); });

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('download-and-extract-animations', async (_event, { url }) => {
  const destDir = path.join(app.getPath('userData'), 'animations');
  return downloadAndExtractAnimations(url, destDir);
});

function watchDisplayChanges() {
  screen.on('display-added', recenterMainWindowIfOffscreen);
  screen.on('display-removed', recenterMainWindowIfOffscreen);
  screen.on('display-metrics-changed', recenterMainWindowIfOffscreen);
}

app.whenReady().then(() => {
  registerAssetProtocol();
  createMainWindow();
  buildTray();
  watchDisplayChanges();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
});