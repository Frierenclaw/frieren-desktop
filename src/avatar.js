import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { EDGE_TTS_VISEME_MAP, MOUTH_EXPRESSIONS } from './visemes.js';

// ── Module state ──────────────────────────────────────────────
let renderer   = null;
let scene      = null;
let camera     = null;
let clock      = null;
let currentVRM = null;
let animFrameId = null;

// Expressions that actually exist in the loaded model
let availableExpressions = new Set();

// ── Viseme state ──────────────────────────────────────────────
let currentVisemeTarget = null;
let visemeResetTimer    = null;
const VISEME_HOLD_MS    = 100;
const VISEME_BLEND_SPEED = 20;

// ── Idle animation timers ─────────────────────────────────────
let breathTime = 0;
let swayTime   = 0;
let armSwayTime = 0;
let weightShiftTime = 0;

// ── Auto-blink state ──────────────────────────────────────────
let blinkTimer     = 0;
let nextBlinkDelay = 2.5;
let blinkPhase     = 'idle'; // 'idle' | 'closing' | 'holding' | 'opening'
let blinkHoldTimer = 0;
const BLINK_CLOSE_SPEED = 12;
const BLINK_OPEN_SPEED  = 7;
const BLINK_HOLD_SECS   = 0.07;

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
export function initAvatar(canvas) {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 20);
  camera.position.set(0, 1.0, 2.3);
  camera.lookAt(new THREE.Vector3(0, 1.0, 0));

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
        if (!vrm) { reject(new Error('Loaded GLTF has no VRM data')); return; }

        VRMUtils.rotateVRM0(vrm);

        const leftArm  = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        if (leftArm)  leftArm.rotation.z  =  1.2;
        if (rightArm) rightArm.rotation.z = -1.2;

        currentVRM = vrm;
        scene.add(vrm.scene);

        // Discover which expressions this model actually supports
        availableExpressions = new Set(
          Object.keys(vrm.expressionManager?.expressionMap ?? {})
        );
        console.log('[avatar] Available expressions:', [...availableExpressions]);
        const testBone = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        console.log('[avatar] leftLowerArm rotation:', testBone?.rotation);
        console.log('[avatar] leftLowerArm world quaternion:', testBone?.getWorldQuaternion(new THREE.Quaternion()));

        // Reset animation state
        blinkPhase = 'idle';
        blinkTimer = 0;
        nextBlinkDelay = 2.5;
        currentVisemeTarget = null;

        resolve(vrm);
      },
      (progress) => {
        if (progress.total > 0)
          console.log(`[avatar] Loading VRM… ${Math.round(progress.loaded / progress.total * 100)}%`);
      },
      (err) => reject(err),
    );
  });
}

export function hasVRM() { return currentVRM !== null; }

// ─────────────────────────────────────────────────────────────
// Visemes
// ─────────────────────────────────────────────────────────────
export function applyViseme(data) {
  if (!currentVRM) return;
  const name = EDGE_TTS_VISEME_MAP[data.viseme_id] ?? null;
  currentVisemeTarget = (name && availableExpressions.has(name)) ? name : null;
  if (visemeResetTimer) clearTimeout(visemeResetTimer);
  visemeResetTimer = setTimeout(() => { currentVisemeTarget = null; }, VISEME_HOLD_MS);
}

export function setExpression(name, value) {
  if (!availableExpressions.has(name)) return;
  currentVRM?.expressionManager?.setValue(name, Math.max(0, Math.min(1, value)));
}

// ─────────────────────────────────────────────────────────────
// Render loop
// ─────────────────────────────────────────────────────────────
function startRenderLoop() {
  if (animFrameId !== null) return;
  function loop() {
    animFrameId = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    if (currentVRM) {
      applyIdleBreathing(delta);
      applyIdleHeadSway(delta);
      applyIdleArmSway(delta);
      applyIdleWeightShift(delta);
      applyBlink(delta);
      smoothVisemes(delta);
      currentVRM.update(delta);
    }
    renderer.render(scene, camera);
  }
  loop();
}

// ─────────────────────────────────────────────────────────────
// Idle: breathing
// ─────────────────────────────────────────────────────────────
function applyIdleBreathing(delta) {
  breathTime += delta;
  const v = Math.sin(breathTime * 0.8) * 0.04; // 0.04 rad ≈ 2.3° — visible

  const h = currentVRM?.humanoid;
  if (!h) return;

  const chest = h.getNormalizedBoneNode('chest');
  if (chest) chest.rotation.x = v;

  const upperChest = h.getNormalizedBoneNode('upperChest');
  if (upperChest) upperChest.rotation.x = v * 0.6;

  const spine = h.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.x = v * 0.3;
}

// ─────────────────────────────────────────────────────────────
// Idle: head sway
// ─────────────────────────────────────────────────────────────
function applyIdleHeadSway(delta) {
  swayTime += delta;
  const h = currentVRM?.humanoid;
  if (!h) return;

  const neck = h.getNormalizedBoneNode('neck');
  if (neck) {
    neck.rotation.y = Math.sin(swayTime * 0.27) * 0.05;
    neck.rotation.z = Math.sin(swayTime * 0.19) * 0.025;
  }

  const head = h.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = Math.sin(swayTime * 0.31) * 0.03;
  }
}

// ─────────────────────────────────────────────────────────────
// Idle: arm sway
// ─────────────────────────────────────────────────────────────

function applyIdleArmSway(delta) {
  armSwayTime += delta;
  const h = currentVRM?.humanoid;
  if (!h) return;

  const leftArm  = h.getNormalizedBoneNode('leftUpperArm');
  const rightArm = h.getNormalizedBoneNode('rightUpperArm');
  const leftLower  = h.getNormalizedBoneNode('leftLowerArm');
  const rightLower = h.getNormalizedBoneNode('rightLowerArm');

  const swing = Math.sin(armSwayTime * 0.7) * 0.03;

  if (leftArm) {
    leftArm.rotation.z = 1.2 + swing;
    leftArm.rotation.y = -0.38;
  }
  if (rightArm) {
    rightArm.rotation.z = -1.2 - swing;
    rightArm.rotation.y = 0.38;
  }

  // Bend elbows (rotation.y is the correct axis for this model)
  const elbowBend = 1.8 + Math.sin(armSwayTime * 0.6 + 1) * 0.03;
  if (leftLower)  leftLower.rotation.y = -elbowBend;
  if (rightLower) rightLower.rotation.y = elbowBend;

  

  // Curl fingers slightly for a relaxed hand (excluding thumb)
  const fingerCurl = 0.35;
  const fingerBones = [
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
  ];

  for (const boneName of fingerBones) {
    const bone = h.getNormalizedBoneNode(boneName);
    if (bone) bone.rotation.z = boneName.startsWith('left') ? fingerCurl : -fingerCurl;
  }
}

function applyIdleWeightShift(delta) {
  weightShiftTime += delta;
  const h = currentVRM?.humanoid;
  if (!h) return;

  const leftShoulder  = h.getNormalizedBoneNode('leftShoulder');
  const rightShoulder = h.getNormalizedBoneNode('rightShoulder');

  const shift = Math.sin(weightShiftTime * 1.0) * 0.06;

  if (leftShoulder)  leftShoulder.rotation.z =  shift;
  if (rightShoulder) rightShoulder.rotation.z = -shift;
}

// ─────────────────────────────────────────────────────────────
// Auto-blink
// ─────────────────────────────────────────────────────────────
function applyBlink(delta) {
  const em = currentVRM?.expressionManager;
  if (!em) return;

  const blinkName = availableExpressions.has('blink')      ? 'blink'
                  : availableExpressions.has('blinkLeft')  ? 'blinkLeft'
                  : null;
  if (!blinkName) return;

  const setBlinkValue = (val) => {
    em.setValue(blinkName, val);
    if (blinkName === 'blinkLeft' && availableExpressions.has('blinkRight'))
      em.setValue('blinkRight', val);
  };

  switch (blinkPhase) {
    case 'idle':
      blinkTimer += delta;
      if (blinkTimer >= nextBlinkDelay) { blinkPhase = 'closing'; blinkTimer = 0; }
      break;

    case 'closing': {
      const next = Math.min(1, (em.getValue(blinkName) ?? 0) + delta * BLINK_CLOSE_SPEED);
      setBlinkValue(next);
      if (next >= 1) { blinkPhase = 'holding'; blinkHoldTimer = 0; }
      break;
    }
    case 'holding':
      blinkHoldTimer += delta;
      if (blinkHoldTimer >= BLINK_HOLD_SECS) blinkPhase = 'opening';
      break;

    case 'opening': {
      const next = Math.max(0, (em.getValue(blinkName) ?? 1) - delta * BLINK_OPEN_SPEED);
      setBlinkValue(next);
      if (next <= 0) {
        blinkPhase = 'idle';
        blinkTimer = 0;
        nextBlinkDelay = 2 + Math.random() * 4;
      }
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Viseme smoothing
// ─────────────────────────────────────────────────────────────
function smoothVisemes(delta) {
  const em = currentVRM?.expressionManager;
  if (!em) return;
  const speed = VISEME_BLEND_SPEED * delta;
  for (const name of MOUTH_EXPRESSIONS) {
    if (!availableExpressions.has(name)) continue;
    const current = em.getValue(name) ?? 0;
    const target  = name === currentVisemeTarget ? 1.0 : 0.0;
    em.setValue(name, lerp(current, target, speed));
  }
}

function lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }

// ─────────────────────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────────────────────
function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
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
    if (e.ctrlKey) { isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY; e.preventDefault(); }
  });
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !currentVRM) return;
    e.preventDefault();
    camera.position.z = Math.max(0.5, Math.min(5, camera.position.z + e.deltaY * 0.001));
  }, { passive: false });
  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentVRM) return;
    const dx = (e.clientX - dragStartX) * 0.005;
    const dy = (e.clientY - dragStartY) * 0.005;
    if (e.shiftKey) {
      currentVRM.scene.rotation.y += dx;
      currentVRM.scene.rotation.x += dy;
    } else {
      modelOffsetX += dx; modelOffsetY -= dy;
      currentVRM.scene.position.set(modelOffsetX, modelOffsetY, 0);
    }
    dragStartX = e.clientX; dragStartY = e.clientY;
  });
  window.addEventListener('mouseup', () => { isDragging = false; });
}

export function resetAvatarTransform() {
  if (!currentVRM) return;
  currentVRM.scene.position.set(0, 0, 0);
  currentVRM.scene.rotation.set(0, 0, 0);
  modelOffsetX = 0; modelOffsetY = 0;
  camera.position.set(0, 1.0, 2.3);
  camera.lookAt(new THREE.Vector3(0, 1.0, 0));
}