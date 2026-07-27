import { ipcMain } from 'electron';
import Store from 'electron-store';

const stores = new Map();

export function getStore(fileName) {
  if (!stores.has(fileName)) {
    stores.set(fileName, new Store({ name: fileName.replace(/\.json$/, '') }));
  }
  return stores.get(fileName);
}

export function registerStoreIpc() {
  ipcMain.handle('store-get', (_event, { file, key }) => getStore(file).get(key) ?? null);
  ipcMain.handle('store-set', (_event, { file, key, value }) => { getStore(file).set(key, value); });
  ipcMain.handle('store-delete', (_event, { file, key }) => { getStore(file).delete(key); });
}
