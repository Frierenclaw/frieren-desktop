import { app, BrowserWindow, Tray, Menu, screen, dialog, ipcMain, nativeImage, protocol, net } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Store from 'electron-store';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('high-dpi-support', '1');

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

function getAllDisplaysBounds() {
  const displays = screen.getAllDisplays();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const d of displays) {
    const { x, y, width, height } = d.bounds;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function loadWindowUrlOrFile(win, entry) {
  if (isDev) {
    win.loadURL(`http://localhost:1420/${entry}`);
  } else {
    win.loadFile(path.join(DIST_DIR, entry));
  }
}

function createMainWindow() {
  const bounds = getAllDisplaysBounds();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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

  win.setBounds(bounds);
  win.setIgnoreMouseEvents(true, { forward: true });
  loadWindowUrlOrFile(win, 'index.html');
  windows.set('main', win);

  console.log('displays', screen.getAllDisplays());
  console.log('unionBounds', bounds);
  console.log('windowBoundsAfterSetBounds', win.getBounds());

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
    { label: 'Refresh Layout', click: () => refreshMainWindowBounds() },
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

function refreshMainWindowBounds() {
  const win = windows.get('main');
  if (!win) return;
  const bounds = getAllDisplaysBounds();
  win.setBounds(bounds);
  win.webContents.send('frieren-event', { event: 'frieren:bounds-refreshed', payload: {} });
}

ipcMain.handle('get-cursor-position', () => {
  const { x, y } = screen.getCursorScreenPoint();
  return { x, y };
});

ipcMain.handle('set-ignore-cursor-events', (event, ignore) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setIgnoreMouseEvents(!!ignore, { forward: true });
});

ipcMain.handle('get-window-position', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const [x, y] = win?.getPosition() ?? [0, 0];
  return { x, y };
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

function watchDisplayChanges() {
  screen.on('display-added', refreshMainWindowBounds);
  screen.on('display-removed', refreshMainWindowBounds);
  screen.on('display-metrics-changed', refreshMainWindowBounds);
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