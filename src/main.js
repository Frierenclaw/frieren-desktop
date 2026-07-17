import {
  onFrierenEvent, emitFrierenEvent,
  setIgnoreCursorEvents, moveWindowBy, resizeWindowCentered, centerWindow,
  openOrFocusSettingsWindow, localPathToFileUrl, quitApp, downloadAndExtractAnimations,
} from './electron-ipc.js';

import {
  initAvatar, loadVRM, applyViseme, initDragControls, resetAvatarTransform,
  onAvatarDragMove, beginAvatarDrag, onAvatarResizeWheel, handleResize,
  loadAnimationClip, playAnimationClip,
} from './avatar.js';
import { connect, disconnect, onViseme, onStateChange, isConnected, tryUnblockAudio, onAudioReady, setAudioInputDevice, setAvailableAnimations } from './livekit-client.js';
import { getConfig } from './config.js';
import { getBaseUrl } from './auth.js';
import { registerFunction, setPlayAnimationHandler } from './agent-tools.js';
import { registerClientFunctions } from './agent-registration.js';

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

const CONTAINER_MARGIN  = 240;
const MIN_CONTAINER_W   = 120;
const MAX_CONTAINER_W   = 800;
const CONTAINER_ASPECT  = 480 / 280;

let containerW = avatarContainer.offsetWidth;
let containerH = avatarContainer.offsetHeight;
applyContainerRect();

function applyContainerRect() {
  avatarContainer.style.left   = `${CONTAINER_MARGIN}px`;
  avatarContainer.style.top    = `${CONTAINER_MARGIN}px`;
  avatarContainer.style.width  = `${containerW}px`;
  avatarContainer.style.height = `${containerH}px`;
  handleResize();
}

let pendingResize = null;

onAvatarResizeWheel(
  (deltaY) => {
    const centerX = CONTAINER_MARGIN + containerW / 2;
    const centerY = CONTAINER_MARGIN + containerH / 2;

    const newW = Math.max(MIN_CONTAINER_W, Math.min(MAX_CONTAINER_W, containerW - deltaY * 0.5));
    const newH = newW * CONTAINER_ASPECT;

    pendingResize = { w: newW, h: newH };

    resizeOutline.style.left   = `${centerX - newW / 2}px`;
    resizeOutline.style.top    = `${centerY - newH / 2}px`;
    resizeOutline.style.width  = `${newW}px`;
    resizeOutline.style.height = `${newH}px`;
    resizeOutline.classList.add('visible');
  },
  () => {
    if (pendingResize) {
      containerW = pendingResize.w;
      containerH = pendingResize.h;
      applyContainerRect();
      resizeWindowCentered(containerW + CONTAINER_MARGIN * 2, containerH + CONTAINER_MARGIN * 2);
      pendingResize = null;
    }
    resizeOutline.classList.remove('visible');
  },
);

onAvatarDragMove((dx, dy) => {
  moveWindowBy(dx, dy);
});

canvas.addEventListener('mousedown', (e) => {
  tryUnblockAudio();

  if (e.ctrlKey) {
    beginAvatarDrag(e.screenX, e.screenY, e.button, e.shiftKey);
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

onFrierenEvent('frieren:connect', async () => {
  try {
    const baseUrl = await getBaseUrl();
    if (baseUrl) {
      try {
        await registerClientFunctions(baseUrl);
      } catch (err) {
        console.warn('[frieren] failed to register agent functions, connecting anyway:', err);
      }
    }
    await connect();
  } catch (err) {
    updateStatusDot('error');
    emitFrierenEvent('frieren:state-update', { state: 'error', error: err.message });
  }
});

onFrierenEvent('frieren:disconnect', async () => {
  await disconnect();
});

onFrierenEvent('frieren:set-audio-device', async (payload) => {
  try {
    await setAudioInputDevice(payload.deviceId);
  } catch (err) {
    console.warn('[frieren] failed to switch audio input device:', err);
  }
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

onFrierenEvent('frieren:load-animations', async (payload) => {
  const { url } = payload;
  try {
    const extracted = await downloadAndExtractAnimations(url);
    registerAnimations(extracted.map((a) => [a.name, localPathToFileUrl(a.filePath)]));
  } catch (err) {
    console.warn('[frieren] failed to load animation archive:', err);
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
  await setIgnoreCursorEvents(enable);
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
  applyContainerRect();
  centerWindow(containerW + CONTAINER_MARGIN * 2, containerH + CONTAINER_MARGIN * 2);
});

registerFunction({
  name: 'open_settings',
  description: 'Opens the settings window so the user can change instance, account, character, or wake word configuration.',
  extended_access_rights: false,
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
}, async () => {
  await openOrFocusSettingsWindow();
  return { opened: true };
});

registerFunction({
  name: 'set_passive_mode',
  description: 'Enables or disables passive mode, which makes the avatar click-through and semi-transparent.',
  extended_access_rights: false,
  input_schema: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'true to enable passive mode, false to disable it' },
    },
    required: ['enabled'],
  },
}, async (args) => {
  await togglePassive(!!args.enabled);
  return { passive: isPassive };
});

registerFunction({
  name: 'get_connection_status',
  description: "Returns whether the client is currently connected to Fern.",
  extended_access_rights: false,
  input_schema: {
    type: 'object',
    properties: {},
    required: [],
  },
}, async () => {
  return { connected: isConnected() };
});

const animationClipUrls = new Map();

export function registerAnimations(entries) {
  animationClipUrls.clear();
  for (const [name, url] of entries) animationClipUrls.set(name, url);
  setAvailableAnimations([...animationClipUrls.keys()]);
}

setPlayAnimationHandler(async (args) => {
  const name = args?.animation;
  if (!name) throw new Error('play_animation called without an animation name');

  const url = animationClipUrls.get(name);
  if (!url) throw new Error(`Unknown animation: ${name}`);

  const clip = await loadAnimationClip(url);
  playAnimationClip(clip);
  return { played: name };
});