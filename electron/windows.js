import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const DIST_DIR = path.join(__dirname, '..', 'dist');

const CONTAINER_MARGIN    = 240;
const DEFAULT_CONTAINER_W = 280;
const DEFAULT_CONTAINER_H = 480;

const windows = new Map();

function loadWindowUrlOrFile(win, entry) {
  if (isDev) {
    win.loadURL(`http://localhost:1420/${entry}`);
  } else {
    win.loadFile(path.join(DIST_DIR, entry));
  }
}

export function getWindow(label) {
  return windows.get(label);
}

export function getAllWindows() {
  return windows;
}

export function createMainWindow() {
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

export function createUiWindow() {
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

export function recenterMainWindowIfOffscreen() {
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

export function watchDisplayChanges() {
  screen.on('display-added', recenterMainWindowIfOffscreen);
  screen.on('display-removed', recenterMainWindowIfOffscreen);
  screen.on('display-metrics-changed', recenterMainWindowIfOffscreen);
}
