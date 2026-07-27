import { app, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWindow, createUiWindow, recenterMainWindowIfOffscreen } from './windows.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let tray = null;

export function buildTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'icons', '32x32.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Frieren Desktop');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Show Avatar',
      click: () => {
        const win = getWindow('main');
        if (win) { win.show(); win.focus(); }
      },
    },
    { label: 'Settings...', click: () => createUiWindow() },
    {
      label: 'Toggle Passive Mode',
      click: () => {
        getWindow('main')?.webContents.send('frieren-event', {
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
    const win = getWindow('main');
    if (!win) return;
    if (win.isVisible()) win.hide();
    else { win.show(); win.focus(); }
  });
}
