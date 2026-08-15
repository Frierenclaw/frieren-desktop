import { moveWindowBy, resizeWindowCentered, centerWindow } from './electron-ipc.js';
import { onAvatarDragMove, onAvatarResizeWheel, handleResize, resetAvatarTransform } from './avatar.js';

const CONTAINER_MARGIN  = 40;
const MIN_CONTAINER_W   = 120;
const MAX_CONTAINER_W   = 800;
const CONTAINER_ASPECT  = 480 / 280;

const avatarContainer = document.getElementById('avatar-container');
const resizeOutline    = document.getElementById('resize-outline');

let containerW = avatarContainer.offsetWidth;
let containerH = avatarContainer.offsetHeight;

function applyContainerRect() {
  avatarContainer.style.left   = `${CONTAINER_MARGIN}px`;
  avatarContainer.style.top    = `${CONTAINER_MARGIN}px`;
  avatarContainer.style.width  = `${containerW}px`;
  avatarContainer.style.height = `${containerH}px`;
  handleResize();
}

export function initWindowControls() {
  applyContainerRect();

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
}

export function resetContainerToDefault() {
  resetAvatarTransform();
  containerW = 280;
  containerH = 480;
  applyContainerRect();
  centerWindow(containerW + CONTAINER_MARGIN * 2, containerH + CONTAINER_MARGIN * 2);
}