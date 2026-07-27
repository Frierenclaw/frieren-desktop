/**
 * ui-connect-gate.js
 *
 * Split out of ui-auth.js so that ui-instance.js and ui-characters.js (which
 * also need to re-check availability after their own state changes) can
 * import it without creating an ui-auth.js <-> ui-characters.js cycle.
 */

import { isLoggedIn } from './auth.js';
import { getConfig } from './config.js';
import { setConnectAvailability } from './ui-connection.js';

/**
 * Connect should be impossible until a character is actually selected,
 * otherwise it ships an empty/stale character_id and the server 404s with
 * "Character not found" instead of a clear client-side message.
 */
export async function updateConnectAvailability() {
  const loggedIn = await isLoggedIn();
  if (!loggedIn) {
    setConnectAvailability(false, '');
    return;
  }
  const config = await getConfig();
  const hasCharacter = !!config.characterId;
  setConnectAvailability(hasCharacter, hasCharacter ? '' : 'Select a character first');
}
