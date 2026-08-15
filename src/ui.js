import { emitFrierenEvent } from './electron-ipc.js';

import { initInstanceSection } from './ui-instance.js';
import { initAuthSection } from './ui-auth.js';
import { initConnectionSection } from './ui-connection.js';
import { initMicrophoneSection } from './ui-microphone.js';
import { initAvatarModelSection } from './ui-avatar-model.js';
import { loadCharacters } from './ui-characters.js';
import { initWakeWordsSection } from './ui-wake-words.js';
import { initInstalledAppsSection } from './ui-installed-apps.js';
import { initUploadSection } from './ui-upload.js';
import { initTextChatSection } from './ui-text-chat.js';

async function init() {

  initConnectionSection();
  initAvatarModelSection();
  initTextChatSection();

  await initInstanceSection();
  await initAuthSection();
  await loadCharacters();
  await initWakeWordsSection();
  await initMicrophoneSection();
  await initInstalledAppsSection();
  await initUploadSection();

  emitFrierenEvent('frieren:state-query');
}

init();