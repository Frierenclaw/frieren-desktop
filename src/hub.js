import { authedFetch, authedUpload, getBaseUrl } from './auth.js';

export const NAME_MAX_LENGTH = 128;
export const DESCRIPTION_MAX_LENGTH = 2048;
export const PROMPT_MAX_LENGTH = 4096;

export async function createCharacter(name, description, prompt) {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('No server configured.');

  const res = await authedFetch(`${baseUrl}/api/v1/hub/`, {
    method: 'POST',
    body: JSON.stringify({ name, description, prompt }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to create character (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.character_id;
}

export async function uploadCharacterModel(characterId, file) {
  const baseUrl = await getBaseUrl();
  const formData = new FormData();
  formData.append('model', file);

  const res = await authedUpload(
    `${baseUrl}/api/v1/hub/model?character_id=${encodeURIComponent(characterId)}`,
    formData,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Model upload failed (${res.status}): ${body}`);
  }
}

export async function uploadCharacterCover(characterId, file) {
  const baseUrl = await getBaseUrl();
  const formData = new FormData();
  formData.append('cover', file);

  const res = await authedUpload(
    `${baseUrl}/api/v1/hub/cover?character_id=${encodeURIComponent(characterId)}`,
    formData,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Cover upload failed (${res.status}): ${body}`);
  }
}

export async function uploadCharacterAnimations(characterId, file) {
  const baseUrl = await getBaseUrl();
  const formData = new FormData();
  formData.append('animations', file);

  const res = await authedUpload(
    `${baseUrl}/api/v1/hub/animations?character_id=${encodeURIComponent(characterId)}`,
    formData,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Animations upload failed (${res.status}): ${body}`);
  }
}