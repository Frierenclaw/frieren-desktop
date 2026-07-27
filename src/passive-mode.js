import { setIgnoreCursorEvents } from './electron-ipc.js';

const passiveBtn = document.getElementById('passive-btn');
const canvas     = document.getElementById('avatar-canvas');

let isPassive = false;

export function isPassiveMode() {
  return isPassive;
}

export async function togglePassive(enable) {
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

export function initPassiveModeControls() {
  document.getElementById('opacity-slider').addEventListener('input', (e) => {
    const val = e.target.value;
    document.getElementById('opacity-value').textContent = `${val}%`;
    if (isPassive) canvas.style.opacity = val / 100;
  });
}
