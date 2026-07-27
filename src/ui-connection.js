/**
 * ui-connection.js, "Connection" card
 *
 * Owns the connect/disconnect buttons and the connection status badge, and
 * listens for frieren:state-update relayed from the avatar window.
 */

import { onFrierenEvent } from './electron-ipc.js';
import { $, sendCommand } from './ui-shared.js';

const connectionBadge      = $('connection-badge');
const connectionStatusText = $('connection-status-text');
const connectBtn           = $('connect-btn');
const disconnectBtn        = $('disconnect-btn');

/**
 * Enables/disables the Connect button. Called by ui-connect-gate.js, which
 * decides *whether* connecting should be allowed (login + character state);
 * this module only owns the DOM.
 */
export function setConnectAvailability(enabled, title = '') {
  connectBtn.disabled = !enabled;
  connectBtn.title = title;
}

function setConnecting() {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting...';
  connectionStatusText.textContent = 'Connecting to Fern...';
  connectionBadge.className = 'badge connecting';
  connectionBadge.textContent = 'Connecting';
}

function setConnected(yes) {
  if (yes) {
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    connectBtn.classList.remove('hidden');
    connectBtn.disabled     = false;
    connectBtn.textContent  = 'Connect';
    disconnectBtn.classList.add('hidden');
  }
}

/**
 * If currently connected (per DOM state), tell the avatar window to
 * disconnect and flip the UI back. Used by ui-auth.js on logout, since an
 * invalidated session can't stay connected.
 */
export function disconnectIfConnected() {
  if (!disconnectBtn.classList.contains('hidden')) {
    sendCommand('frieren:disconnect');
    setConnected(false);
  }
}

export function initConnectionSection() {
  connectBtn.addEventListener('click', async () => {
    setConnecting();
    try {
      sendCommand('frieren:connect');
      // State will update via the frieren:state-update relay below
    } catch (err) {
      connectionStatusText.textContent = `Error: ${err.message}`;
      setConnected(false);
    }
  });

  disconnectBtn.addEventListener('click', () => {
    sendCommand('frieren:disconnect');
    setConnected(false);
  });

  // Listen for state updates from the avatar window
  onFrierenEvent('frieren:state-update', (payload) => {
    const { state, error } = /** @type {{ state: string, error?: string }} */ (payload);

    const labels = {
      connected:    'Connected to Fern',
      connecting:   'Connecting...',
      disconnected: 'Disconnected',
      error:        `Error: ${error ?? 'unknown'}`,
    };
    connectionStatusText.textContent = labels[state] ?? state;

    connectionBadge.className = `badge ${state === 'error' ? 'disconnected' : state}`;
    connectionBadge.textContent = state.charAt(0).toUpperCase() + state.slice(1);

    if (state === 'connected') {
      setConnected(true);
    } else if (state === 'disconnected' || state === 'error') {
      setConnected(false);
    }
  });
}
