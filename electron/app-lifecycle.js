import { app, ipcMain } from 'electron';
import path from 'node:path';
import { downloadAndExtractAnimations } from './animation-archive.js';

export function registerAppLifecycleIpc() {
  ipcMain.handle('app-exit', (_event, code) => { app.exit(code ?? 0); });

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('download-and-extract-animations', async (_event, { url }) => {
    const destDir = path.join(app.getPath('userData'), 'animations');
    return downloadAndExtractAnimations(url, destDir);
  });
}
