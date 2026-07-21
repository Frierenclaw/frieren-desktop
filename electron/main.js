import { app, BrowserWindow, Tray, Menu, screen, dialog, ipcMain, nativeImage, protocol, net, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
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

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'spotify:']);

let _installedAppsCache = null;
let _installedAppsScannedAt = null;
let _appRescanTimer = null;

const NOISE_PATTERNS = [
  'uninstall', 'readme', 'read me', 'changelog', 'license',
  'documentation', 'help', 'website', 'support', 'update',
];

function normalizeAppName(raw) {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function isNoiseEntry(name) {
  const n = name.toLowerCase();
  return NOISE_PATTERNS.some((p) => n.includes(p));
}

function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const aBig = bigrams(a);
  const bBig = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of aBig) {
    if (bBig.has(bg)) overlap += Math.min(count, bBig.get(bg));
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function scoreMatch(query, candidateNormalized) {
  if (candidateNormalized === query) return 1;
  const queryTokens = query.split(' ').filter(Boolean);
  const candTokens = candidateNormalized.split(' ').filter(Boolean);
  const allTokensPresent = queryTokens.length > 0 && queryTokens.every((t) => candTokens.includes(t));
  if (allTokensPresent) return 0.9;
  if (candidateNormalized.includes(query)) return 0.8;
  return diceCoefficient(query, candidateNormalized) * 0.7;
}

async function walkForShortcuts(dir, results) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForShortcuts(full, results);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.lnk')) continue;
    const name = path.basename(entry.name, '.lnk');
    if (isNoiseEntry(name)) continue;
    try {
      const { target } = shell.readShortcutLink(full);
      if (!target) continue;
      results.push({ name, normalized: normalizeAppName(name), target, kind: 'shortcut' });
    } catch {
      continue;
    }
  }
}

async function scanWindowsApps() {
  const dirs = [
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
  const results = [];
  for (const dir of dirs) await walkForShortcuts(dir, results);
  return results;
}

async function scanMacApps() {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  const results = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.app')) continue;
      const name = path.basename(entry.name, '.app');
      if (isNoiseEntry(name)) continue;
      results.push({ name, normalized: normalizeAppName(name), target: path.join(dir, entry.name), kind: 'bundle' });
    }
  }
  return results;
}

async function scanLinuxApps() {
  const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
  const results = [];
  for (const dir of dirs) {
    let fileNames;
    try {
      fileNames = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (!fileName.toLowerCase().endsWith('.desktop')) continue;
      const full = path.join(dir, fileName);
      let content;
      try {
        content = await fsp.readFile(full, 'utf8');
      } catch {
        continue;
      }
      if (/^NoDisplay\s*=\s*true/im.test(content)) continue;
      const nameMatch = content.match(/^Name=(.+)$/m);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim();
      if (isNoiseEntry(name)) continue;
      results.push({ name, normalized: normalizeAppName(name), target: full, kind: 'desktop-entry' });
    }
  }
  return results;
}

async function getInstalledApps(forceRescan) {
  if (_installedAppsCache && !forceRescan) return _installedAppsCache;
  const scanner =
    process.platform === 'win32' ? scanWindowsApps :
    process.platform === 'darwin' ? scanMacApps :
    scanLinuxApps;
  _installedAppsCache = await scanner();
  _installedAppsScannedAt = Date.now();
  return _installedAppsCache;
}

function scheduleAppRescan(minutes) {
  if (_appRescanTimer) {
    clearInterval(_appRescanTimer);
    _appRescanTimer = null;
  }
  const ms = Number(minutes) * 60 * 1000;
  if (!ms || ms <= 0) return;
  _appRescanTimer = setInterval(() => {
    getInstalledApps(true).catch(() => {});
  }, ms);
}

ipcMain.handle('list-installed-apps', async (_event, { forceRescan } = {}) => {
  const apps = await getInstalledApps(!!forceRescan);
  return { names: apps.map((a) => a.name), scannedAt: _installedAppsScannedAt };
});

ipcMain.handle('set-app-rescan-interval', (_event, minutes) => {
  scheduleAppRescan(minutes);
});

const MATCH_THRESHOLD = 0.55;

ipcMain.handle('launch-app', async (_event, { name } = {}) => {
  const rawQuery = (name ?? '').trim();
  if (!rawQuery) throw new Error('No app name given');
  const query = normalizeAppName(rawQuery);

  const apps = await getInstalledApps(false);
  let best = null;
  let bestScore = 0;
  for (const a of apps) {
    const score = scoreMatch(query, a.normalized);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  if (!best || bestScore < MATCH_THRESHOLD) return { launched: false, reason: 'not_found' };

  await shell.openPath(best.target);
  return { launched: true, name: best.name, matchScore: Number(bestScore.toFixed(2)) };
});

ipcMain.handle('open-external', async (_event, rawUrl) => {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_EXTERNAL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`Refusing to open disallowed scheme: ${parsed.protocol}`);
  }

  await shell.openExternal(parsed.href);
  return { opened: parsed.href };
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

  const savedMinutes = getStore('frieren-config.json').get('config')?.appRescanMinutes ?? 0;
  scheduleAppRescan(savedMinutes);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
});