import { app, BrowserWindow } from 'electron';
import { registerAssetProtocol } from './asset-protocol.js';
import { createMainWindow, watchDisplayChanges } from './windows.js';
import { buildTray } from './tray.js';
import { registerStoreIpc } from './store.js';
import { registerWindowIpc } from './window-ipc.js';
import { registerDialogIpc } from './dialog.js';
import { registerExternalOpenIpc } from './external-open.js';
import { registerInstalledAppsIpc, initAppRescanTimer } from './installed-apps.js';
import { registerAppLifecycleIpc } from './app-lifecycle.js';

registerStoreIpc();
registerWindowIpc();
registerDialogIpc();
registerExternalOpenIpc();
registerInstalledAppsIpc();
registerAppLifecycleIpc();

app.whenReady().then(() => {
  registerAssetProtocol();
  createMainWindow();
  buildTray();
  watchDisplayChanges();
  initAppRescanTimer();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
  }
});
