import { ipcMain, BrowserWindow, dialog } from 'electron';

export function registerDialogIpc() {
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
}
