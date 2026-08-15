import { authedFetch, getBaseUrl } from './auth.js';
import { getConfig } from './config.js';
import { getClientId } from './client-id.js';

export const CHAT_BACKEND_AVAILABLE = false;

const CHAT_ENDPOINT = '/api/v1/chat/message';

export async function sendTextMessage(message) {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('No server configured. Please log in first.');

  const config = await getConfig();
  if (!config.characterId) throw new Error('No character selected. Please select a character in settings.');

  const clientId = await getClientId();

  const res = await authedFetch(`${baseUrl}${CHAT_ENDPOINT}`, {
    method: 'POST',
    body: JSON.stringify({
      character_id: config.characterId,
      client_id: clientId,
      message,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Chat request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.reply ?? '';
}