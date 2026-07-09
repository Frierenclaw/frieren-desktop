import {
  onFrierenEvent, emitFrierenEvent,
  getCursorPosition, setIgnoreCursorEvents, getWindowPosition,
  openOrFocusSettingsWindow, localPathToFileUrl, quitApp,
} from './electron-ipc.js';

import {
  initAvatar, loadVRM, applyViseme, initDragControls, resetAvatarTransform,
  onAvatarDrag, onAvatarDragMove, beginAvatarDrag, onAvatarResizeWheel, handleResize,
} from './avatar.js';
import { connect, disconnect, onViseme, onStateChange, isConnected, tryUnblockAudio, onAudioReady } from './livekit-client.js';
import { getConfig } from './config.js';

const contextMenu   = document.getElementById('context-menu');
const controlsPanel = document.getElementById('controls-panel');
const passiveBtn    = document.getElementById('passive-btn');
let isPassive       = false;

const canvas          = document.getElementById('avatar-canvas');
const avatarContainer = document.getElementById('avatar-container');
const resizeOutline    = document.getElementById('resize-outline');
const statusDot       = document.getElementById('status-dot');

initAvatar(canvas);
initDragControls(canvas);

console.log('[frieren] window.innerWidth', window.innerWidth, 'window.innerHeight', window.innerHeight, 'devicePixelRatio', window.devicePixelRatio);

const MIN_CONTAINER_W = 120;
const MAX_CONTAINER_W = 800;
const CONTAINER_ASPECT = 480 / 280;

let containerW = avatarContainer.offsetWidth;
let containerH = avatarContainer.offsetHeight;
let containerX = Math.round(window.innerWidth  / 2 - containerW / 2);
let containerY = Math.round(window.innerHeight / 2 - containerH / 2);
applyContainerRect();

function applyContainerRect() {
  avatarContainer.style.left   = `${containerX}px`;
  avatarContainer.style.top    = `${containerY}px`;
  avatarContainer.style.width  = `${containerW}px`;
  avatarContainer.style.height = `${containerH}px`;
  handleResize();
}

let pendingResize = null;

onAvatarResizeWheel(
  (deltaY) => {
    gestureInProgress = true;
    const cx = containerX + containerW / 2;
    const cy = containerY + containerH / 2;

    const newW = Math.max(MIN_CONTAINER_W, Math.min(MAX_CONTAINER_W, containerW - deltaY * 0.5));
    const newH = newW * CONTAINER_ASPECT;

    pendingResize = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };

    resizeOutline.style.left   = `${pendingResize.x}px`;
    resizeOutline.style.top    = `${pendingResize.y}px`;
    resizeOutline.style.width  = `${pendingResize.w}px`;
    resizeOutline.style.height = `${pendingResize.h}px`;
    resizeOutline.classList.add('visible');
  },
  () => {
    if (pendingResize) {
      containerX = pendingResize.x;
      containerY = pendingResize.y;
      containerW = pendingResize.w;
      containerH = pendingResize.h;
      applyContainerRect();
      pendingResize = null;
    }
    resizeOutline.classList.remove('visible');
    gestureInProgress = false;
  },
);

const HIT_TEST_INTERVAL_MS = 80;

let windowIsInteractive = true;
let gestureInProgress   = false;
let cachedWindowOrigin  = null;
let lastHitTestLog = 0;

async function setInteractive(shouldBeInteractive) {
  if (shouldBeInteractive === windowIsInteractive) return;
  windowIsInteractive = shouldBeInteractive;
  try {
    await setIgnoreCursorEvents(!shouldBeInteractive);
  } catch (err) {
    console.warn('[frieren] setIgnoreCursorEvents failed:', err);
  }
}

function avatarBounds() {
  const r = avatarContainer.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
}

function pointInBounds(x, y, bounds) {
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function floatingPanelBounds(el) {
  if (!el.classList.contains('visible')) return null;
  const r = el.getBoundingClientRect();
  const margin = 6;
  return {
    left:   r.left - margin,
    right:  r.right + margin,
    top:    r.top - margin,
    bottom: r.bottom + margin,
  };
}

function pointInAnyInteractiveZone(x, y) {
  const boxes = [avatarBounds(), floatingPanelBounds(contextMenu), floatingPanelBounds(controlsPanel)];
  return boxes.some((b) => b && pointInBounds(x, y, b));
}

async function hitTestTick() {
  if (isPassive) {
    await setInteractive(false);
    return;
  }

  if (gestureInProgress) {
    await setInteractive(true);
    return;
  }

  try {
    if (!cachedWindowOrigin) {
      cachedWindowOrigin = await getWindowPosition();
      console.log('[frieren] cachedWindowOrigin', cachedWindowOrigin);
    }
    const { x, y } = await getCursorPosition();
    const cssX = x - cachedWindowOrigin.x;
    const cssY = y - cachedWindowOrigin.y;

    const inside = pointInAnyInteractiveZone(cssX, cssY);

    const now = performance.now();
    if (now - lastHitTestLog > 1000) {
      lastHitTestLog = now;
      console.log('[frieren] cursor', x, y, 'css', cssX, cssY, 'avatarBounds', avatarBounds(), 'inside', inside);
    }

    await setInteractive(inside);
  } catch (err) {
    console.warn('[frieren] cursor hit-test failed:', err);
  }
}

setInteractive(false).then(() => { hitTestTick(); });
setInterval(hitTestTick, HIT_TEST_INTERVAL_MS);

onAvatarDrag(
  () => { gestureInProgress = true; },
  () => { gestureInProgress = false; },
);

onAvatarDragMove((dx, dy) => {
  containerX += dx;
  containerY += dy;
  avatarContainer.style.left = `${containerX}px`;
  avatarContainer.style.top  = `${containerY}px`;
});

canvas.addEventListener('mousedown', (e) => {
  tryUnblockAudio();

  if (e.ctrlKey) {
    beginAvatarDrag(e.clientX, e.clientY, e.button, e.shiftKey);
    e.preventDefault();
  } else if (e.button === 0) {
  }
});

canvas.addEventListener('auxclick', (e) => {
  if (e.button === 1 && e.ctrlKey) e.preventDefault();
});

(async () => {
  const config = await getConfig();
  if (config.avatarPath) {
    try {
      const path = config.avatarPath;
      const isRemote = path.startsWith('http://') || path.startsWith('https://');
      await loadVRM(isRemote ? path : localPathToFileUrl(path));
    } catch (err) {
      console.warn('Failed to restore avatar:', err);
    }
  }
})();

onViseme((visemeData) => {
  applyViseme(visemeData);
});

onStateChange((state) => {
  updateStatusDot(state);
  emitFrierenEvent('frieren:state-update', { state });
});

onFrierenEvent('frieren:bounds-refreshed', () => {
  cachedWindowOrigin = null;
});

onFrierenEvent('frieren:connect', async () => {
  try {
    await connect();
  } catch (err) {
    updateStatusDot('error');
    emitFrierenEvent('frieren:state-update', { state: 'error', error: err.message });
  }
});

onFrierenEvent('frieren:disconnect', async () => {
  await disconnect();
});

onFrierenEvent('frieren:toggle-passive', async () => {
  await togglePassive(!isPassive);
});

onFrierenEvent('frieren:load-vrm', async (payload) => {
  const { path } = payload;
  try {
    const isRemote = path.startsWith('http://') || path.startsWith('https://');
    await loadVRM(isRemote ? path : localPathToFileUrl(path));
  } catch (err) {
    console.error('Failed to load VRM:', err);
  }
});

onFrierenEvent('frieren:state-query', () => {
  emitFrierenEvent('frieren:state-update', { state: isConnected() ? 'connected' : 'disconnected' });
});

function updateStatusDot(state) {
  statusDot.className = `status ${state}`;
  const labels = {
    connected:    'Connected',
    connecting:   'Connecting...',
    disconnected: 'Disconnected',
    error:        'Error',
  };
  statusDot.title = labels[state] ?? state;
}

function hideAll() {
  contextMenu.classList.remove('visible');
  controlsPanel.classList.remove('visible');
}

function positionFloating(el, x, y) {
  el.classList.add('visible');
  const rect = el.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  el.style.left = `${Math.max(4, Math.min(x, maxX))}px`;
  el.style.top  = `${Math.max(4, Math.min(y, maxY))}px`;
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  hideAll();
  positionFloating(contextMenu, e.clientX, e.clientY);
});

window.addEventListener('mousedown', (e) => {
  if (!contextMenu.contains(e.target) && !controlsPanel.contains(e.target)) {
    hideAll();
  }
});

document.getElementById('ctx-settings').addEventListener('click', async () => {
  hideAll();
  await openOrFocusSettingsWindow();
});

document.getElementById('ctx-controls').addEventListener('click', (e) => {
  hideAll();
  positionFloating(controlsPanel, e.clientX, e.clientY);
});

document.getElementById('ctx-passive').addEventListener('click', async () => {
  hideAll();
  await togglePassive(true);
});

document.getElementById('ctx-quit').addEventListener('click', async () => {
  await quitApp(0);
});

async function togglePassive(enable) {
  isPassive = enable;
  await setInteractive(!enable);
  passiveBtn.classList.toggle('visible', enable);
  document.getElementById('ctx-passive').textContent = enable
    ? '👁 Disable passive mode'
    : '👁 Enable passive mode';

  const opacity = enable
    ? (document.getElementById('opacity-slider').value / 100)
    : 1.0;
  canvas.style.opacity = opacity;
}

document.getElementById('opacity-slider').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('opacity-value').textContent = `${val}%`;
  if (isPassive) canvas.style.opacity = val / 100;
});

document.getElementById('reset-btn').addEventListener('click', () => {
  hideAll();
  resetAvatarTransform();
  containerW = 280;
  containerH = 480;
  containerX = Math.round(window.innerWidth  / 2 - containerW / 2);
  containerY = Math.round(window.innerHeight / 2 - containerH / 2);
  applyContainerRect();
});