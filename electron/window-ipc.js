import { ipcMain, BrowserWindow, screen } from 'electron';
import { getAllWindows, createUiWindow } from './windows.js';

const _smoothMoveTimers = new Map();

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function registerWindowIpc() {
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

  ipcMain.handle('get-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.getBounds() ?? null;
  });

  ipcMain.handle('get-display-work-area', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const display = screen.getDisplayMatching(win.getBounds());
    return display.workArea;
  });

  ipcMain.handle('move-window-by', (event, { dx, dy }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const b = win.getBounds();
    win.setBounds({ ...b, x: Math.round(b.x + dx), y: Math.round(b.y + dy) });
  });

  ipcMain.handle('move-window-smooth', (event, { dx, dy, durationMs = 900 }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { completed: false };

    const winId = win.webContents.id;
    const existingTimer = _smoothMoveTimers.get(winId);
    if (existingTimer) clearInterval(existingTimer);

    const startBounds = win.getBounds();
    const startX = startBounds.x;
    const startY = startBounds.y;
    const targetX = Math.round(startX + dx);
    const targetY = Math.round(startY + dy);
    const startTime = Date.now();

    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (win.isDestroyed()) {
          clearInterval(timer);
          _smoothMoveTimers.delete(winId);
          resolve({ completed: false });
          return;
        }

        const elapsed = Date.now() - startTime;
        const t = Math.min(1, durationMs > 0 ? elapsed / durationMs : 1);
        const eased = easeInOutQuad(t);
        const b = win.getBounds();
        win.setBounds({
          ...b,
          x: Math.round(startX + (targetX - startX) * eased),
          y: Math.round(startY + (targetY - startY) * eased),
        });

        if (t >= 1) {
          clearInterval(timer);
          _smoothMoveTimers.delete(winId);
          resolve({ completed: true, x: targetX, y: targetY });
        }
      }, 16);

      _smoothMoveTimers.set(winId, timer);
    });
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
      getAllWindows().get(target)?.webContents.send('frieren-event', { event: evtName, payload });
    } else {
      for (const win of getAllWindows().values()) {
        win.webContents.send('frieren-event', { event: evtName, payload });
      }
    }
  });
}