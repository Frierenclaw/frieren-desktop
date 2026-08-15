import { getWindowBounds, getDisplayWorkArea, moveWindowSmooth } from './electron-ipc.js';
import { startWalking, stopWalking, isGesturePlaying, hasVRM } from './avatar.js';

const WALK_MIN_INTERVAL_MS = 15_000;
const WALK_MAX_INTERVAL_MS = 45_000;
const WALK_MIN_DISTANCE_PX = 120;
const WALK_MAX_DISTANCE_PX = 420;
const WALK_SPEED_PX_PER_SEC = 90;

let _enabled = false;
let _walking = false;
let _timerId = null;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function scheduleNext() {
  if (!_enabled) return;
  clearTimeout(_timerId);
  _timerId = setTimeout(planNextWalk, randomBetween(WALK_MIN_INTERVAL_MS, WALK_MAX_INTERVAL_MS));
}

async function planNextWalk() {
  if (!_enabled) return;

  if (_walking || isGesturePlaying() || !hasVRM()) {
    scheduleNext();
    return;
  }

  const [bounds, workArea] = await Promise.all([getWindowBounds(), getDisplayWorkArea()]);
  if (!bounds || !workArea) {
    scheduleNext();
    return;
  }

  const distance  = randomBetween(WALK_MIN_DISTANCE_PX, WALK_MAX_DISTANCE_PX);
  const direction = Math.random() < 0.5 ? -1 : 1;
  let dx = distance * direction;

  const targetX = bounds.x + dx;
  if (targetX < workArea.x || targetX + bounds.width > workArea.x + workArea.width) {
    dx = -dx;
  }

  const recheckX = bounds.x + dx;
  if (recheckX < workArea.x || recheckX + bounds.width > workArea.x + workArea.width) {
    scheduleNext();
    return;
  }

  const durationMs = Math.max(400, Math.round((Math.abs(dx) / WALK_SPEED_PX_PER_SEC) * 1000));

  _walking = true;

  try {
    await startWalking(dx >= 0 ? 1 : -1);
    await moveWindowSmooth(dx, 0, durationMs);
  } catch (err) {
    console.warn('[walk] smooth move failed:', err);
  } finally {
    await stopWalking();
    _walking = false;
    scheduleNext();
  }
}

export function initAutonomousWalk() {
  if (_enabled) return;
  _enabled = true;
  scheduleNext();
}

export function stopAutonomousWalk() {
  _enabled = false;
  clearTimeout(_timerId);
}