/**
 * ui-avatar-model.js, "Avatar Model" card
 */

import { openFileDialog } from './electron-ipc.js';
import { setAvatarPath } from './config.js';
import { $, sendCommand } from './ui-shared.js';

const avatarInfo = $('avatar-info');
const loadVrmBtn = $('load-vrm-btn');

/** Used by ui-characters.js when a selected character ships its own model_url. */
export function setAvatarInfoText(text) {
  avatarInfo.textContent = text;
}

export function initAvatarModelSection() {
  loadVrmBtn.addEventListener('click', async () => {
    try {
      const selected = await openFileDialog({
        title:    'Select VRM Avatar Model',
        filters:  [{ name: 'VRM Model', extensions: ['vrm'] }],
        multiple: false,
      });

      if (!selected) return; // user cancelled

      const filePath = typeof selected === 'string' ? selected : selected[0];

      // Tell the avatar window to load this model
      sendCommand('frieren:load-vrm', { path: filePath });

      // Save path so it auto-loads next time
      await setAvatarPath(filePath);

      const fileName = filePath.split(/[/\\]/).pop();
      avatarInfo.textContent = `Loaded: ${fileName}`;
    } catch (err) {
      avatarInfo.textContent = `Failed to load: ${err.message}`;
    }
  });
}
