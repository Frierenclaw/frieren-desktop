/**
 * ui-characters.js, "Character" card
 */

import { isLoggedIn, getBaseUrl, authedFetch } from './auth.js';
import { getConfig, setCharacterId, setAvatarPath } from './config.js';
import { $, sendCommand } from './ui-shared.js';
import { updateConnectAvailability } from './ui-connect-gate.js';
import { setAvatarInfoText } from './ui-avatar-model.js';

const characterStatus = $('character-status');
const characterList   = $('character-list');

export async function loadCharacters() {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    characterStatus.textContent = 'Log in to see characters';
    characterList.innerHTML = '';
    return;
  }

  characterStatus.textContent = 'Loading characters...';
  characterList.innerHTML = '';

  try {
    const baseUrl = await getBaseUrl();
    const res = await authedFetch(`${baseUrl}/api/v1/hub/all`);
    if (!res.ok) throw new Error(`${res.status}`);

    const data = await res.json();
    const characters = data.items ?? [];

    if (characters.length === 0) {
      characterStatus.textContent = 'No characters found.';
      return;
    }

    characterStatus.textContent = `${characters.length} character(s) available`;

    const config = await getConfig();

    characters.forEach((char) => {
      const card = document.createElement('div');
      card.className = 'character-card' + (char.id === config.characterId ? ' selected' : '');
      card.dataset.id = char.id;

      // Cover image or placeholder emoji
      const cover = char.cover_url
        ? `<img class="character-cover" src="${char.cover_url}" alt="" onerror="this.outerHTML='<div class=\\'character-cover placeholder\\'>🦋</div>'" />`
        : `<div class="character-cover placeholder">🦋</div>`;

      card.innerHTML = `
        ${cover}
        <div class="character-info">
          <div class="character-name">${char.name}</div>
          <div class="character-desc">${char.description ?? ''}</div>
        </div>
      `;

      card.addEventListener('click', async () => {
        // Deselect all
        characterList.querySelectorAll('.character-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        await setCharacterId(char.id);
        await updateConnectAvailability();

        // If the character has a model_url, auto-load it
        if (char.model_url) {
          sendCommand('frieren:load-vrm', { path: char.model_url });
          await setAvatarPath(char.model_url);
          setAvatarInfoText(`Loaded: ${char.name}`);
        }

        if (char.animations_url) {
          sendCommand('frieren:load-animations', { url: char.animations_url });
        }
      });

      characterList.appendChild(card);
    });
  } catch (err) {
    characterStatus.textContent = `Error: ${err.message}`;
  }
}
