import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import {
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
  createVRMAnimationClip,
} from '@pixiv/three-vrm-animation';
import { isValidViseme, MOUTH_EXPRESSIONS } from './visemes.js';

let renderer   = null;
let scene      = null;
let camera     = null;
let clock      = null;
let currentVRM = null;
let animFrameId = null;

let mixer             = null;
let currentAction     = null;
let gesturePlaying    = false;
const vrmAnimationCache = new Map();

let availableExpressions = new Set();

let currentVisemeTarget = null;
let visemeResetTimer    = null;
const VISEME_HOLD_MS    = 100;
const VISEME_BLEND_SPEED = 20;

const VISEME_LOG_INTERVAL = 0.5;
let   _visemeLogAccumulator = 0;

let breathTime = 0;
let swayTime   = 0;
let armSwayTime = 0;
let weightShiftTime = 0;

let walkState  = 'idle';
let walkBlend  = 0;
let walkTime   = 0;
let walkPhase  = 0;
let facingSign = 1;
let _walkTransitionResolve = null;
const _targetFacingQuaternion = new THREE.Quaternion();
const _neutralFacingQuaternion = new THREE.Quaternion();
const _turnDeltaQuaternion = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const WALK_CYCLE_SPEED  = 6;
const WALK_STRIDE       = 0.5;
const WALK_BOB_HEIGHT   = 0.02;
const WALK_ARM_SWING    = 0.35;
const WALK_FACING_ANGLE = Math.PI / 2;
const TURN_SPEED         = Math.PI * 1.4;
const WALK_BLEND_RATE    = 5;

let blinkTimer     = 0;
let nextBlinkDelay = 2.5;
let blinkPhase     = 'idle';
let blinkHoldTimer = 0;
const BLINK_CLOSE_SPEED = 12;
const BLINK_OPEN_SPEED  = 7;
const BLINK_HOLD_SECS   = 0.07;

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

function createGLTFLoader() {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

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

        availableExpressions = new Set(
          Object.keys(vrm.expressionManager?.expressionMap ?? {})
        );
        console.log('[avatar] Available expressions:', [...availableExpressions]);
        const testBone = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        console.log('[avatar] leftLowerArm rotation:', testBone?.rotation);
        console.log('[avatar] leftLowerArm world quaternion:', testBone?.getWorldQuaternion(new THREE.Quaternion()));

        blinkPhase = 'idle';
        blinkTimer = 0;
        nextBlinkDelay = 2.5;
        currentVisemeTarget = null;
        walkState = 'idle';
        walkBlend = 0;
        walkTime = 0;
        walkPhase = 0;
        facingSign = 1;
        _walkTransitionResolve = null;
        _neutralFacingQuaternion.copy(vrm.scene.quaternion);
        vrm.scene.position.y = 0;

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

const FRAME_MARGIN = 1.15;

function frameAvatar() {
  if (!currentVRM || !camera) return;

  const box = new THREE.Box3().setFromObject(currentVRM.scene);
  if (box.isEmpty()) return;

  const height = box.max.y - box.min.y;
  const centerY = (box.max.y + box.min.y) / 2;

  const vFovRad = (camera.fov * Math.PI) / 180;
  const distance = (height * FRAME_MARGIN) / (2 * Math.tan(vFovRad / 2));

  camera.position.set(0, centerY, distance);
  camera.lookAt(new THREE.Vector3(0, centerY, 0));
  camera.updateProjectionMatrix();
}

export function applyViseme(data) {
  if (!currentVRM) {
    console.warn('[viseme] applyViseme called but no VRM is loaded');
    return;
  }

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

export function startWalking(direction) {
  facingSign = direction >= 0 ? 1 : -1;
  if (!currentVRM) { walkState = 'walking'; return Promise.resolve(); }

  _turnDeltaQuaternion.setFromAxisAngle(_yAxis, facingSign * WALK_FACING_ANGLE);
  _targetFacingQuaternion.copy(_neutralFacingQuaternion).multiply(_turnDeltaQuaternion);
  walkState = 'turning';

  return new Promise((resolve) => { _walkTransitionResolve = resolve; });
}

export function stopWalking() {
  if (walkState === 'idle') return Promise.resolve();

  _targetFacingQuaternion.copy(_neutralFacingQuaternion);
  walkState = 'returning';

  return new Promise((resolve) => { _walkTransitionResolve = resolve; });
}

function updateFacing(delta) {
  if (!currentVRM) return;
  if (walkState !== 'turning' && walkState !== 'returning') return;

  const step = TURN_SPEED * delta;
  currentVRM.scene.quaternion.rotateTowards(_targetFacingQuaternion, step);

  if (currentVRM.scene.quaternion.equals(_targetFacingQuaternion)) {
    walkState = walkState === 'turning' ? 'walking' : 'idle';
    _walkTransitionResolve?.();
    _walkTransitionResolve = null;
  }
}

function updateWalkBlend(delta) {
  const target = walkState === 'walking' ? 1 : 0;
  const rate = 1 - Math.exp(-WALK_BLEND_RATE * delta);
  walkBlend += (target - walkBlend) * rate;
  if (Math.abs(walkBlend - target) < 0.001) walkBlend = target;
}

function applyWalkCycle(delta) {
  const h = currentVRM?.humanoid;
  if (!h) return;

  if (walkState === 'walking') {
    walkTime += delta;
    walkPhase = Math.sin(walkTime * WALK_CYCLE_SPEED);
  }

  if (walkBlend <= 0.001 && walkState !== 'walking') return;

  const leftUpperLeg  = h.getNormalizedBoneNode('leftUpperLeg');
  const rightUpperLeg = h.getNormalizedBoneNode('rightUpperLeg');
  const leftLowerLeg  = h.getNormalizedBoneNode('leftLowerLeg');
  const rightLowerLeg = h.getNormalizedBoneNode('rightLowerLeg');

  if (leftUpperLeg)  leftUpperLeg.rotation.x  =  walkPhase * WALK_STRIDE * walkBlend;
  if (rightUpperLeg) rightUpperLeg.rotation.x = -walkPhase * WALK_STRIDE * walkBlend;

  if (leftLowerLeg)  leftLowerLeg.rotation.x  = -Math.max(0, -walkPhase) * WALK_STRIDE * 1.4 * walkBlend;
  if (rightLowerLeg) rightLowerLeg.rotation.x = -Math.max(0,  walkPhase) * WALK_STRIDE * 1.4 * walkBlend;

  if (currentVRM) {
    currentVRM.scene.position.y = Math.abs(walkPhase) * WALK_BOB_HEIGHT * walkBlend;
  }
}

function startRenderLoop() {
  if (animFrameId !== null) return;
  function loop() {
    animFrameId = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    if (currentVRM) {
      updateFacing(delta);
      updateWalkBlend(delta);
      applyWalkCycle(delta);
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

function applyIdleBreathing(delta) {
  if (gesturePlaying) return;
  breathTime += delta;
  const v = Math.sin(breathTime * 0.8) * 0.04 * (1 - walkBlend);

  const h = currentVRM?.humanoid;
  if (!h) return;

  const chest = h.getNormalizedBoneNode('chest');
  if (chest) chest.rotation.x = v;

  const upperChest = h.getNormalizedBoneNode('upperChest');
  if (upperChest) upperChest.rotation.x = v * 0.6;

  const spine = h.getNormalizedBoneNode('spine');
  if (spine) spine.rotation.x = v * 0.3;
}

function applyIdleHeadSway(delta) {
  if (gesturePlaying) return;
  swayTime += delta;
  const h = currentVRM?.humanoid;
  if (!h) return;
  const amp = 1 - walkBlend;

  const neck = h.getNormalizedBoneNode('neck');
  if (neck) {
    neck.rotation.y = Math.sin(swayTime * 0.27) * 0.05 * amp;
    neck.rotation.z = Math.sin(swayTime * 0.19) * 0.025 * amp;
  }

  const head = h.getNormalizedBoneNode('head');
  if (head) {
    head.rotation.y = Math.sin(swayTime * 0.31) * 0.03 * amp;
  }
}

function applyIdleArmSway(delta) {
  if (gesturePlaying) return;
  armSwayTime += delta;
  const h = currentVRM?.humanoid;
  if (!h) return;
  const amp = 1 - walkBlend;

  const leftArm  = h.getNormalizedBoneNode('leftUpperArm');
  const rightArm = h.getNormalizedBoneNode('rightUpperArm');
  const leftLower  = h.getNormalizedBoneNode('leftLowerArm');
  const rightLower = h.getNormalizedBoneNode('rightLowerArm');

  const swing = Math.sin(armSwayTime * 0.7) * 0.03 * amp;

  if (leftArm) {
    leftArm.rotation.z = 1.2 + swing;
    leftArm.rotation.y = -0.38;
    leftArm.rotation.x = -walkPhase * WALK_ARM_SWING * walkBlend;
  }
  if (rightArm) {
    rightArm.rotation.z = -1.2 - swing;
    rightArm.rotation.y = 0.38;
    rightArm.rotation.x = walkPhase * WALK_ARM_SWING * walkBlend;
  }

  const elbowBend = 1.8 + Math.sin(armSwayTime * 0.6 + 1) * 0.03;
  if (leftLower)  leftLower.rotation.y = -elbowBend;
  if (rightLower) rightLower.rotation.y = elbowBend;

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

  const shift = Math.sin(weightShiftTime * 1.0) * 0.06 * (1 - walkBlend);

  if (leftShoulder)  leftShoulder.rotation.z =  shift;
  if (rightShoulder) rightShoulder.rotation.z = -shift;
}

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

function smoothVisemes(delta) {
  const em = currentVRM?.expressionManager;
  if (!em) return;
  const speed = VISEME_BLEND_SPEED * delta;

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

export function handleResize() {
  if (!renderer || !camera) return;
  const canvas = renderer.domElement;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight;
  camera.updateProjectionMatrix();
}

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

export function onAvatarDragMove(cb) {
  _onDragMove = cb;
}

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

    camera.position.z = Math.max(0.5, Math.min(5, camera.position.z + e.deltaY * 0.001));
    return;
  }

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
  currentVRM.scene.quaternion.copy(_neutralFacingQuaternion);
  frameAvatar();
}