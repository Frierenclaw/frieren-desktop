function bridge() {
  if (!window.electronIPC) {
    throw new Error('[electron-ipc] window.electronIPC is not available, is the preload script missing?');
  }
  return window.electronIPC;
}

const _listeners = new Map();
let _relayInstalled = false;

function _installRelay() {
  if (_relayInstalled) return;
  _relayInstalled = true;
  bridge().on('frieren-event', ({ event: evtName, payload }) => {
    const cbs = _listeners.get(evtName);
    if (!cbs) return;
    for (const cb of cbs) cb(payload);
  });
}

export function onFrierenEvent(eventName, callback) {
  _installRelay();
  if (!_listeners.has(eventName)) _listeners.set(eventName, new Set());
  _listeners.get(eventName).add(callback);
  return () => { _listeners.get(eventName)?.delete(callback); };
}

export function emitFrierenEvent(eventName, payload = {}) {
  bridge().send('frieren-emit', { event: eventName, payload, target: null });
}

export function emitFrierenEventTo(label, eventName, payload = {}) {
  bridge().send('frieren-emit', { event: eventName, payload, target: label });
}

export async function getCursorPosition() {
  return bridge().invoke('get-cursor-position');
}

export async function setIgnoreCursorEvents(ignore) {
  return bridge().invoke('set-ignore-cursor-events', ignore);
}

export async function getWindowPosition() {
  return bridge().invoke('get-window-position');
}

export async function openOrFocusSettingsWindow() {
  return bridge().invoke('open-ui-window');
}

export async function storeGet(file, key) {
  return bridge().invoke('store-get', { file, key });
}

export async function storeSet(file, key, value) {
  return bridge().invoke('store-set', { file, key, value });
}

export async function storeDelete(file, key) {
  return bridge().invoke('store-delete', { file, key });
}

export async function openFileDialog(options) {
  return bridge().invoke('dialog-open', options);
}

export function localPathToFileUrl(path) {
  const normalized = path.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return `frieren-asset://local${withLeadingSlash}`;
}

export async function quitApp(code = 0) {
  return bridge().invoke('app-exit', code);
}