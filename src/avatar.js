import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import { isValidViseme, MOUTH_EXPRESSIONS } from './visemes.js';

// ── Module state ──────────────────────────────────────────────
let renderer   = null;
let scene      = null;
let camera     = null;
let clock      = null;
let currentVRM = null;
let animFrameId = null;

// ── Gesture clip (.vrma) state ──────────────────────────────────
let mixer             = null;
let currentAction     = null;
let gesturePlaying    = false;
const vrmAnimationCache = new Map();

// Expressions that actually exist in the loaded model
let availableExpressions = new Set();

// ── Viseme state ──────────────────────────────────────────────
let currentVisemeTarget = null;
let visemeResetTimer    = null;
const VISEME_HOLD_MS    = 100;
const VISEME_BLEND_SPEED = 20;

// Throttle for the smoothVisemes debug log (seconds between snapshots).
const VISEME_LOG_INTERVAL = 0.5;
let   _visemeLogAccumulator = 0;

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
// Shared GLTFLoader
// ─────────────────────────────────────────────────────────────
function createGLTFLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

// ─────────────────────────────────────────────────────────────
// VRM Loading
// ─────────────────────────────────────────────────────────────
export async function loadVRM(url) {
  const loader = createGLTFLoader();

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

        const lookAtQuatProxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
        lookAtQuatProxy.name = 'lookAtQuaternionProxy';
        vrm.scene.add(lookAtQuatProxy);

        frameAvatar();

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

        mixer = new THREE.AnimationMixer(vrm.scene);
        currentAction  = null;
        gesturePlaying = false;

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
// Camera framing
// ─────────────────────────────────────────────────────────────
const FRAME_MARGIN = 1.15; // extra headroom/footroom so the model isn't edge-to-edge

function frameAvatar() {
  if (!currentVRM || !camera) return;

  const box = new THREE.Box3().setFromObject(currentVRM.scene);
  if (box.isEmpty()) return;

  const height = box.max.y - box.min.y;
  const centerY = (box.max.y + box.min.y) / 2;

  // Distance needed for the model's full height to fit the camera's
  // vertical FOV, with FRAME_MARGIN of breathing room top/bottom.
  const vFovRad = (camera.fov * Math.PI) / 180;
  const distance = (height * FRAME_MARGIN) / (2 * Math.tan(vFovRad / 2));

  camera.position.set(0, centerY, distance);
  camera.lookAt(new THREE.Vector3(0, centerY, 0));
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────────────
// Visemes
// ─────────────────────────────────────────────────────────────
export function applyViseme(data) {
  if (!currentVRM) {
    console.warn('[viseme] applyViseme called but no VRM is loaded');
    return;
  }
  // Fern already resolves the spoken word to a VRM expression name (see
  // visemes.js), so we just validate it against both the viseme set and the
  // expressions the loaded model actually supports.
  const name = data?.viseme;

  if (!isValidViseme(name)) {
    console.debug('[viseme] ignored, not a valid viseme name:', name, 'data:', data);
    return;
  }

  if (!availableExpressions.has(name)) {
    console.warn(
      '[viseme] "%s" is a valid viseme but the loaded model does not expose it. '
      + 'Available mouth expressions:', name,
      MOUTH_EXPRESSIONS.filter((m) => availableExpressions.has(m)),
    );
    return;
  }

  currentVisemeTarget = name;
  if (visemeResetTimer) clearTimeout(visemeResetTimer);
  visemeResetTimer = setTimeout(() => { currentVisemeTarget = null; }, VISEME_HOLD_MS);
}

export function setExpression(name, value) {
  if (!availableExpressions.has(name)) return;
  currentVRM?.expressionManager?.setValue(name, Math.max(0, Math.min(1, value)));
}

// ─────────────────────────────────────────────────────────────
// Gesture clips (.vrma)
// ─────────────────────────────────────────────────────────────
async function fetchVRMAnimation(url) {
  if (vrmAnimationCache.has(url)) return vrmAnimationCache.get(url);

  const loader = createGLTFLoader();
  const gltf = await loader.loadAsync(url);
  const vrmAnimation = gltf.userData.vrmAnimations?.[0];
  if (!vrmAnimation) throw new Error(`No VRM animation found in ${url}`);

  vrmAnimationCache.set(url, vrmAnimation);
  return vrmAnimation;
}

export async function loadAnimationClip(url) {
  if (!currentVRM) throw new Error('Load an avatar before loading animation clips.');
  const vrmAnimation = await fetchVRMAnimation(url);
  return createVRMAnimationClip(vrmAnimation, currentVRM);
}

export function playAnimationClip(clip, { loop = false, fadeSeconds = 0.25, onFinished } = {}) {
  if (!mixer || !currentVRM) return null;

  currentAction?.fadeOut(fadeSeconds);

  const action = mixer.clipAction(clip);
  action.reset();
  action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  action.clampWhenFinished = !loop;
  action.fadeIn(fadeSeconds).play();

  currentAction  = action;
  gesturePlaying = true;

  if (!loop) {
    const handleFinished = (e) => {
      if (e.action !== action) return;
      mixer.removeEventListener('finished', handleFinished);
      gesturePlaying = false;
      if (currentAction === action) currentAction = null;
      onFinished?.();
    };
    mixer.addEventListener('finished', handleFinished);
  }

  return action;
}

export function stopAnimationClip(fadeSeconds = 0.25) {
  currentAction?.fadeOut(fadeSeconds);
  currentAction  = null;
  gesturePlaying = false;
}

export function isGesturePlaying() { return gesturePlaying; }

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
      mixer?.update(delta);
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
  if (gesturePlaying) return;
  breathTime += delta;
  const v = Math.sin(breathTime * 0.8) * 0.04; // 0.04 rad ≈ 2.3°; visible

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
  if (gesturePlaying) return;
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
  if (gesturePlaying) return;
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
  if (gesturePlaying) return;
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

  // Snapshot the applied mouth expression values for an occasional debug log.
  // Throttled so we don't flood the console every frame.
  let shouldLog = false;
  _visemeLogAccumulator += delta;
  if (_visemeLogAccumulator >= VISEME_LOG_INTERVAL) {
    _visemeLogAccumulator = 0;
    shouldLog = currentVisemeTarget !== null;
  }

  const snapshot = shouldLog ? {} : null;
  for (const name of MOUTH_EXPRESSIONS) {
    if (!availableExpressions.has(name)) continue;
    const current = em.getValue(name) ?? 0;
    const target  = name === currentVisemeTarget ? 1.0 : 0.0;
    em.setValue(name, lerp(current, target, speed));
    if (snapshot) snapshot[name] = +em.getValue(name)?.toFixed(2);
  }

  if (snapshot) {
    console.debug('[viseme] target=%s applied=%o', currentVisemeTarget, snapshot);
  }
}

function lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }

// ─────────────────────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────────────────────
export function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}

// ─────────────────────────────────────────────────────────────
// Drag controls
// ─────────────────────────────────────────────────────────────
let isDragging   = false;
let dragStartX   = 0;
let dragStartY   = 0;
let dragButton   = 0;
let dragShift    = false;
let _onDragStart = null;
let _onDragEnd   = null;
let _onDragMove  = null;
let _onResizeWheel = null;
let _onResizeEnd    = null;

export function onAvatarDrag(onStart, onEnd) {
  _onDragStart = onStart;
  _onDragEnd   = onEnd;
}

// Fires with (dx, dy) in CSS px during a plain Ctrl-drag (no Shift)
export function onAvatarDragMove(cb) {
  _onDragMove = cb;
}

// Fires with deltaY during Ctrl+scroll (resize the container). onEnd
// fires once scrolling/Ctrl stops, so main.js knows when to commit.
export function onAvatarResizeWheel(onWheel, onEnd) {
  _onResizeWheel = onWheel;
  _onResizeEnd   = onEnd;
}

export function beginAvatarDrag(screenX, screenY, button = 0, shiftKey = false) {
  if (!currentVRM) return;
  isDragging = true;
  dragStartX = screenX;
  dragStartY = screenY;
  dragButton = button;
  dragShift  = shiftKey;
  _onDragStart?.();
}

let resizeEndTimer = null;
const RESIZE_END_DELAY_MS = 250;

let resizeInProgress = false;

function handleZoomOrResizeWheel(e) {
  if (e.shiftKey) {
    // Ctrl+Shift+scroll: digital camera zoom, frame stays fixed
    camera.position.z = Math.max(0.5, Math.min(5, camera.position.z + e.deltaY * 0.001));
    return;
  }

  // Ctrl+scroll: resize the canvas/AABB itself
  resizeInProgress = true;
  _onResizeWheel?.(e.deltaY);
  clearTimeout(resizeEndTimer);
  resizeEndTimer = setTimeout(() => { resizeInProgress = false; _onResizeEnd?.(); }, RESIZE_END_DELAY_MS);
}

export function initDragControls(canvas) {
  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey || !currentVRM) return;
    e.preventDefault();
    e.stopPropagation();
    handleZoomOrResizeWheel(e);
  }, { passive: false });

  // Once a resize gesture starts on the canvas, keep tracking it on
  // window too the canvas itself may shrink out from under the
  // cursor mid-gesture, which would otherwise stall the resize.
  window.addEventListener('wheel', (e) => {
    if (!resizeInProgress || !e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    handleZoomOrResizeWheel(e);
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Control') {
      clearTimeout(resizeEndTimer);
      if (resizeInProgress) { resizeInProgress = false; _onResizeEnd?.(); }
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging || !currentVRM) return;
    const dx = e.screenX - dragStartX;
    const dy = e.screenY - dragStartY;

    if (dragButton === 1 && dragShift) {
      currentVRM.scene.rotation.y += dx * 0.005;
      currentVRM.scene.rotation.x += dy * 0.005;
    } else if (dragButton === 0 && dragShift) {
      currentVRM.scene.position.x += dx * 0.002;
      currentVRM.scene.position.y -= dy * 0.002;
    } else {
      _onDragMove?.(dx, dy);
    }

    dragStartX = e.screenX; dragStartY = e.screenY;
  });
  window.addEventListener('mouseup', () => {
    if (isDragging) { isDragging = false; _onDragEnd?.(); }
  });
}

export function resetAvatarTransform() {
  if (!currentVRM) return;
  currentVRM.scene.position.set(0, 0, 0);
  currentVRM.scene.rotation.set(0, 0, 0);
  frameAvatar();
}