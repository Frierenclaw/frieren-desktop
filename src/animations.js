import { setAvailableAnimations } from './livekit-client.js';
import { loadAnimationClip, playAnimationClip } from './avatar.js';
import { setPlayAnimationHandler } from './agent-tools.js';

const animationClipUrls = new Map();

export function registerAnimations(entries) {
  animationClipUrls.clear();
  for (const [name, url] of entries) animationClipUrls.set(name, url);
  setAvailableAnimations([...animationClipUrls.keys()]);
}

export function initAnimationPlayback() {
  setPlayAnimationHandler(async (args) => {
    const name = args?.animation;
    if (!name) throw new Error('play_animation called without an animation name');

    const url = animationClipUrls.get(name);
    if (!url) throw new Error(`Unknown animation: ${name}`);

    const clip = await loadAnimationClip(url);
    playAnimationClip(clip);
    return { played: name };
  });
}
