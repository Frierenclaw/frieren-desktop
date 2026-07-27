/**
 * ui.js, Settings / control window entry point
 *
 * Thin orchestrator: each ui-*.js module owns one settings card (its DOM
 * refs + listeners) and exposes an init*Section() that wires it up and does
 * its own initial render. This file just calls them, in the same order the
 * old monolithic init() did, then asks the avatar window for its current
 * connection state.
 */

import { emitFrierenEvent } from './electron-ipc.js';

import { initInstanceSection } from './ui-instance.js';
import { initAuthSection } from './ui-auth.js';
import { initConnectionSection } from './ui-connection.js';
import { initMicrophoneSection } from './ui-microphone.js';
import { initAvatarModelSection } from './ui-avatar-model.js';
import { loadCharacters } from './ui-characters.js';
import { initWakeWordsSection } from './ui-wake-words.js';
import { initInstalledAppsSection } from './ui-installed-apps.js';

async function init() {
  // No initial async render for these two, just listener wiring.
  initConnectionSection();
  initAvatarModelSection();

  await initInstanceSection();
  await initAuthSection();
  await loadCharacters();
  await initWakeWordsSection();
  await initMicrophoneSection();
  await initInstalledAppsSection();

  // Ask the avatar window for its current connection state
  emitFrierenEvent('frieren:state-query');
}

init();
