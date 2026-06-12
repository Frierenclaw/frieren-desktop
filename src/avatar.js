/**
 * avatar.js — Three.js + @pixiv/three-vrm avatar renderer
 *
 * Handles:
 *   - WebGL renderer setup (transparent background)
 *   - VRM model loading
 *   - Idle breathing animation
 *   - Real-time viseme application (lip-sync from Fern TTS)
 *   - Expression helpers (blink, etc.)
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { EDGE_TTS_VISEME_MAP, MOUTH_EXPRESSIONS } from './visemes.js';

// ── Module state ─────────────────────────────────────────────
let renderer  = null;
let scene     = null;
let camera    = null;
let clock     = null;
/** @type {import('@pixiv/three-vrm').VRM | null} */
let currentVRM = null;
let animFrameId = null;

// Viseme smoothing
let currentVisemeTarget = 'neutral';
let visemeResetTimer    = null;
const VISEME_HOLD_MS    = 80;   // how long to hold each viseme shape
const VISEME_BLEND_SPEED = 15;  // lerp speed for smooth mouth movement

// Idle animation
let breathTime = 0;

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────

/**
 * Initialize the Three.js renderer on the given canvas.
 * Must be called once before anything else.
 * @param {HTMLCanvasElement} canvas
 */
export function initAvatar(canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,               // transparent background
    antialias: true,
    premultipliedAlpha: false,
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);  // fully transparent
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  // Camera positioned at head-level for a portrait-style view
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 20);
  camera.position.set(0, 1.0, 2.3);
  camera.lookAt(new THREE.Vector3(0, 1.0, 0));

  // Soft ambient + key light
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0xfff4e0, 1.0);
  key.position.set(0.5, 2, 1.5);
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.4);
  fill.position.set(-1, 1, -0.5);
  scene.add(fill);

  clock = new THREE.Clock();

  window.addEventListener('resize', handleResize);
  startRenderLoop();
}

// ─────────────────────────────────────────────────────────────
// VRM Loading
// ─────────────────────────────────────────────────────────────

/**
 * Load a VRM model from a URL or file path.
 * Replaces any previously loaded model.
 * @param {string} url
 * @returns {Promise<import('@pixiv/three-vrm').VRM>}
 */
export async function loadVRM(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        if (currentVRM) {
          scene.remove(currentVRM.scene);
          VRMUtils.deepDispose(currentVRM.scene);
          currentVRM = null;
        }

        const vrm = gltf.userData.vrm;
        if (!vrm) {
          reject(new Error('Loaded GLTF has no VRM data'));
          return;
        }

        VRMUtils.rotateVRM0(vrm);

        // Idle arm pose
        const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftArm) leftArm.rotation.z = 1.2;
        if (rightArm) rightArm.rotation.z = -1.2;

        currentVRM = vrm;
        scene.add(vrm.scene);

        resolve(vrm);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[avatar] Loading VRM… ${pct}%`);
        }
      },
      (err) => reject(err),
    );
  });
}

/** True if a VRM model is currently loaded. */
export function hasVRM() {
  return currentVRM !== null;
}

// ─────────────────────────────────────────────────────────────
// Lip-sync / Visemes
// ─────────────────────────────────────────────────────────────

/**
 * Apply a viseme from Fern's TTS pipeline.
 *
 * Expected payload (sent via LiveKit data channel):
 *   { type: 'viseme', viseme_id: number, audio_offset?: number }
 *
 * @param {{ type: string, viseme_id: number, audio_offset?: number }} data
 */
export function applyViseme(data) {
  if (!currentVRM) return;

  const expressionName = EDGE_TTS_VISEME_MAP[data.viseme_id] ?? 'neutral';
  currentVisemeTarget  = expressionName;

  // Auto-reset to neutral after the hold duration
  if (visemeResetTimer) clearTimeout(visemeResetTimer);
  visemeResetTimer = setTimeout(() => {
    currentVisemeTarget = 'neutral';
  }, VISEME_HOLD_MS);
}

/**
 * Set a named VRM expression directly (0.0–1.0).
 * @param {string} name
 * @param {number} value
 */
export function setExpression(name, value) {
  currentVRM?.expressionManager?.setValue(name, Math.max(0, Math.min(1, value)));
}

// ─────────────────────────────────────────────────────────────
// Render Loop
// ─────────────────────────────────────────────────────────────

function startRenderLoop() {
  if (animFrameId !== null) return;

  function loop() {
    animFrameId = requestAnimationFrame(loop);
    const delta = clock.getDelta();

    if (currentVRM) {
      applyIdleBreathing(delta);
      smoothVisemes(delta);
      currentVRM.update(delta);   // spring bones, look-at, etc.
    }

    renderer.render(scene, camera);
  }

  loop();
}

// ─────────────────────────────────────────────────────────────
// Idle animations
// ─────────────────────────────────────────────────────────────

function applyIdleBreathing(delta) {
  breathTime += delta;

  // Subtle chest rise — won't conflict with VRM spring bones
  const breathValue = Math.sin(breathTime * 0.9) * 0.012;
  const humanoid    = currentVRM?.humanoid;
  if (!humanoid) return;

  const chest = humanoid.getRawBoneNode('chest');
  if (chest) chest.rotation.x = breathValue;

  const spine = humanoid.getRawBoneNode('spine');
  if (spine) spine.rotation.x = breathValue * 0.5;
}

/** Smoothly lerp mouth blendshapes toward the current viseme target. */
function smoothVisemes(delta) {
  const em = currentVRM?.expressionManager;
  if (!em) return;

  const speed = VISEME_BLEND_SPEED * delta;

  for (const name of MOUTH_EXPRESSIONS) {
    const current = em.getValue(name) ?? 0;
    const target  = name === currentVisemeTarget ? 1.0 : 0.0;
    em.setValue(name, lerp(current, target, speed));
  }
}

function lerp(a, b, t) {
  return a + (b - a) * Math.min(t, 1);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────────────
// Drag controls
// ─────────────────────────────────────────────────────────────

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let modelOffsetX = 0;
let modelOffsetY = 0;

export function initDragControls(canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (e.ctrlKey) {
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      e.preventDefault();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !currentVRM) return;
    e.preventDefault();
    const zoomSpeed = 0.001;
    camera.position.z += e.deltaY * zoomSpeed;
    camera.position.z = Math.max(0.5, Math.min(5, camera.position.z));
  }, { passive: false });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentVRM) return;

    const dx = (e.clientX - dragStartX) * 0.005;
    const dy = (e.clientY - dragStartY) * 0.005;

    if (e.shiftKey) {
      // Ctrl + Shift + Drag = rotate
      currentVRM.scene.rotation.y += dx;
      currentVRM.scene.rotation.x += dy;
    } else {
      // Ctrl + Drag = move
      modelOffsetX += dx;
      modelOffsetY -= dy;
      currentVRM.scene.position.set(modelOffsetX, modelOffsetY, 0);
    }

    dragStartX = e.clientX;
    dragStartY = e.clientY;
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

export function resetAvatarTransform() {
  if (!currentVRM) return;
  currentVRM.scene.position.set(0, 0, 0);
  currentVRM.scene.rotation.set(0, 0, 0);
  modelOffsetX = 0;
  modelOffsetY = 0;
  camera.position.set(0, 1.0, 2.3);
  camera.lookAt(new THREE.Vector3(0, 1.0, 0));
}