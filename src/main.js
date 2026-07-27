import {
  onFrierenEvent, emitFrierenEvent,
  localPathToFileUrl, downloadAndExtractAnimations,
} from './electron-ipc.js';

import {
  initAvatar, loadVRM, applyViseme, initDragControls, beginAvatarDrag,
} from './avatar.js';
import {
  connect, disconnect, onViseme, onStateChange, isConnected,
  tryUnblockAudio, setAudioInputDevice,
} from './livekit-client.js';
import { getConfig } from './config.js';
import { getBaseUrl } from './auth.js';
import { registerClientFunctions } from './agent-registration.js';

import { initWindowControls } from './window-controls.js';
import { togglePassive, isPassiveMode, initPassiveModeControls } from './passive-mode.js';
import { initContextMenu } from './context-menu.js';
import { registerAnimations, initAnimationPlayback } from './animations.js';
import { loadAgentPlugins } from './agent-plugins/loader.js';

const canvas    = document.getElementById('avatar-canvas');
const statusDot = document.getElementById('status-dot');

initAvatar(canvas);
initDragControls(canvas);
initWindowControls();
initPassiveModeControls();
initContextMenu();
initAnimationPlayback();
loadAgentPlugins();

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
    if (!baseUrl) throw new Error('No server configured. Please set an instance and log in first.');
    await registerClientFunctions(baseUrl);
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
  await togglePassive(!isPassiveMode());
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
