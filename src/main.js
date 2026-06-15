import { listen, emit }      from '@tauri-apps/api/event';
import { WebviewWindow }     from '@tauri-apps/api/webviewWindow';
import { convertFileSrc }    from '@tauri-apps/api/core';

import { initAvatar, loadVRM, applyViseme, initDragControls, resetAvatarTransform } from './avatar.js';
import { connect, disconnect, onViseme, onStateChange, isConnected } from './livekit-client.js';
import { getConfig } from './config.js';
import { getCurrentWindow } from '@tauri-apps/api/window';

import { exit } from '@tauri-apps/plugin-process';

// ── Context menu ──
const contextMenu   = document.getElementById('context-menu');
const controlsPanel = document.getElementById('controls-panel');
const passiveBtn    = document.getElementById('passive-btn');
let isPassive       = false;

const canvas    = document.getElementById('avatar-canvas');
const statusDot = document.getElementById('status-dot');

initAvatar(canvas);
initDragControls(canvas);

const appWindow = getCurrentWindow();
canvas.addEventListener('mousedown', async (e) => {
  if (!e.ctrlKey && e.button === 0) {
    await appWindow.startDragging();
  }
});

(async () => {
  const config = await getConfig();
  if (config.avatarPath) {
    try {
      const path = config.avatarPath;
      const isRemote = path.startsWith('http://') || path.startsWith('https://');
      await loadVRM(isRemote ? path : convertFileSrc(path));
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
  emit('frieren:state-update', { state }).catch(() => {});
});

listen('frieren:connect', async () => {
  try {
    await connect();
  } catch (err) {
    updateStatusDot('error');
    emit('frieren:state-update', { state: 'error', error: err.message }).catch(() => {});
  }
});

listen('frieren:toggle-passive', async () => {
  await togglePassive(!isPassive);
});

listen('frieren:load-vrm', async (event) => {
  const { path } = event.payload;
  try {
    const isRemote = path.startsWith('http://') || path.startsWith('https://');
    await loadVRM(isRemote ? path : convertFileSrc(path));
  } catch (err) {
    console.error('Failed to load VRM:', err);
  }
});

listen('frieren:state-query', () => {
  emit('frieren:state-update', { state: isConnected() ? 'connected' : 'disconnected' }).catch(() => {});
});

function updateStatusDot(state) {
  statusDot.className = `status ${state}`;
  const labels = {
    connected:    'Connected',
    connecting:   'Connecting…',
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
  const existing = await WebviewWindow.getByLabel('ui');
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow('ui', {
    url:         'ui.html',
    title:       'Frieren Desktop — Settings',
    width:       460,
    height:      580,
    minWidth:    360,
    minHeight:   480,
    resizable:   true,
    decorations: true,
    alwaysOnTop: false,
    center:      true,
  });
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
  await exit(0);
});

passiveBtn.addEventListener('click', async () => {
  await togglePassive(false);
});

async function togglePassive(enable) {
  isPassive = enable;
  await appWindow.setIgnoreCursorEvents(enable);
  passiveBtn.classList.toggle('visible', enable);
  document.getElementById('ctx-passive').textContent = enable
    ? '👁 Disable passive mode'
    : '👁 Enable passive mode';

  const opacity = enable
    ? (document.getElementById('opacity-slider').value / 100)
    : 1.0;
  canvas.style.opacity = opacity;
}

// ── Opacity slider ──
document.getElementById('opacity-slider').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('opacity-value').textContent = `${val}%`;
  if (isPassive) canvas.style.opacity = val / 100;
});

// ── Reset position ──
document.getElementById('reset-btn').addEventListener('click', () => {
  hideAll();
  resetAvatarTransform();
});
