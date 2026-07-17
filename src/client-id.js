import { storeGet, storeSet } from './electron-ipc.js';

const CLIENT_FILE = 'frieren-client.json';

let _cachedId = null;

export async function getClientId() {
  if (_cachedId) return _cachedId;

  const existing = await storeGet(CLIENT_FILE, 'client_id');
  if (existing) {
    _cachedId = existing;
    return existing;
  }

  const id = crypto.randomUUID();
  await storeSet(CLIENT_FILE, 'client_id', id);
  _cachedId = id;
  return id;
}