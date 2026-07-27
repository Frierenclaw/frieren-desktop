/**
 * ui-shared.js, tiny helpers shared across every ui-*.js section module.
 */

import { emitFrierenEventTo } from './electron-ipc.js';

export const $ = (id) => document.getElementById(id);

/** Send an event to the avatar (main) window. */
export function sendCommand(eventName, payload = {}) {
  emitFrierenEventTo('main', eventName, payload);
}
