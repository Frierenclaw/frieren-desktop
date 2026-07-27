import { openOrFocusSettingsWindow, quitApp } from './electron-ipc.js';
import { togglePassive } from './passive-mode.js';
import { resetContainerToDefault } from './window-controls.js';

const contextMenu   = document.getElementById('context-menu');
const controlsPanel = document.getElementById('controls-panel');
const canvas         = document.getElementById('avatar-canvas');

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

export function initContextMenu() {
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

  document.getElementById('reset-btn').addEventListener('click', () => {
    hideAll();
    resetContainerToDefault();
  });
}
