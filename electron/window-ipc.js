import { ipcMain, BrowserWindow, screen } from 'electron';
import { getAllWindows, createUiWindow } from './windows.js';

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
      getAllWindows().get(target)?.webContents.send('frieren-event', { event: evtName, payload });
    } else {
      for (const win of getAllWindows().values()) {
        win.webContents.send('frieren-event', { event: evtName, payload });
      }
    }
  });
}
