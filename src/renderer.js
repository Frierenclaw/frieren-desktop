import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

let scene, camera, renderer, vrm, clock;

export function initRenderer(canvas) {
  clock = new THREE.Clock();

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);

  // Camera
  camera = new THREE.PerspectiveCamera(
    30,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    20
  );
  camera.position.set(0, 0.8, 3);
  camera.lookAt(0, 0.8, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 2.0);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  // Resize handler
  window.addEventListener("resize", () => {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  });

  // Animation loop
  animate();
}

export async function loadAvatar(url) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));

  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        // Remove previous avatar if any
        if (vrm) scene.remove(vrm.scene);

        vrm = gltf.userData.vrm;
        VRMUtils.removeUnnecessaryJoints(vrm.scene);

        // Flip the model (VRM models are mirrored by default)
        VRMUtils.rotateVRM0(vrm);

        scene.add(vrm.scene);
        resolve(vrm);
      },
      undefined,
      reject
    );
  });
}

export function updateViseme(visemeId, weight) {
  if (!vrm) return;
  // Visemes come as VRM blendshape IDs
  vrm.expressionManager?.setValue(visemeId, weight);
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (vrm) vrm.update(delta);
  renderer.render(scene, camera);
}