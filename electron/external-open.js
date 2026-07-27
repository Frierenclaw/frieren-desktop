import { ipcMain, shell } from 'electron';

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'spotify:']);

export function registerExternalOpenIpc() {
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
}
