/**
 * ui.js — Settings / control window entry point
 *
 * Handles:
 *   - Instance management (add / select Heiter endpoints)
 *   - Authentication (login / logout)
 *   - Connect / disconnect controls
 *   - VRM model file selection
 *
 * Sends commands to the avatar window via Tauri event bus.
 */

import { listen, emit, emitTo } from '@tauri-apps/api/event';
import { open as openDialog }   from '@tauri-apps/plugin-dialog';

import { login, logout, isLoggedIn, getBaseUrl } from './auth.js';
import {
  getConfig,
  saveConfig,
  getActiveInstanceUrl,
  addInstance,
  setSelectedInstance,
  setAvatarPath,
} from './config.js';

// ─────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const instanceSelect       = $('instance-select');
const addInstanceBtn       = $('add-instance-btn');
const addInstanceForm      = $('add-instance-form');
const newInstanceName      = $('new-instance-name');
const newInstanceUrl       = $('new-instance-url');
const saveInstanceBtn      = $('save-instance-btn');
const cancelInstanceBtn    = $('cancel-instance-btn');

const loginForm            = $('login-form');
const usernameInput        = $('username');
const passwordInput        = $('password');
const loginBtn             = $('login-btn');
const authError            = $('auth-error');
const loggedInView         = $('logged-in-view');
const authInfo             = $('auth-info');
const logoutBtn            = $('logout-btn');

const connectionBadge      = $('connection-badge');
const connectionStatusText = $('connection-status-text');
const connectBtn           = $('connect-btn');
const disconnectBtn        = $('disconnect-btn');

const avatarInfo           = $('avatar-info');
const loadVrmBtn           = $('load-vrm-btn');

// ─────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────

async function init() {
  await renderInstances();
  await renderAuthState();

  // Ask the main window for current connection state
  await emit('frieren:state-query');
}

// ─────────────────────────────────────────────────────────────
// Instance section
// ─────────────────────────────────────────────────────────────

async function renderInstances() {
  const config = await getConfig();
  instanceSelect.innerHTML = '';

  config.instances.forEach((inst, i) => {
    const opt     = document.createElement('option');
    opt.value     = String(i);
    opt.textContent = inst.name;
    instanceSelect.appendChild(opt);
  });

  instanceSelect.value = String(config.selectedInstance ?? 0);
}

instanceSelect.addEventListener('change', async () => {
  await setSelectedInstance(Number(instanceSelect.value));
});

addInstanceBtn.addEventListener('click', () => {
  addInstanceForm.classList.toggle('hidden');
});

cancelInstanceBtn.addEventListener('click', () => {
  addInstanceForm.classList.add('hidden');
  newInstanceName.value = '';
  newInstanceUrl.value  = '';
});

saveInstanceBtn.addEventListener('click', async () => {
  const name = newInstanceName.value.trim();
  const url  = newInstanceUrl.value.trim();
  if (!name || !url) {
    alert('Please enter both a name and a URL.');
    return;
  }
  try { new URL(url); } catch {
    alert('Invalid URL — please include https://');
    return;
  }

  const updatedConfig = await addInstance(name, url);
  await setSelectedInstance(updatedConfig.instances.length - 1);
  await renderInstances();
  addInstanceForm.classList.add('hidden');
  newInstanceName.value = '';
  newInstanceUrl.value  = '';
});

// ─────────────────────────────────────────────────────────────
// Auth section
// ─────────────────────────────────────────────────────────────

async function renderAuthState() {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    loginForm.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    const baseUrl    = await getBaseUrl();
    authInfo.textContent = `Logged in to ${baseUrl}`;
    connectBtn.disabled  = false;
  } else {
    loginForm.classList.remove('hidden');
    loggedInView.classList.add('hidden');
    connectBtn.disabled = true;
  }
}

loginBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const baseUrl  = await getActiveInstanceUrl();

  if (!username || !password) {
    showAuthError('Username and password are required.');
    return;
  }

  loginBtn.disabled     = true;
  loginBtn.textContent  = 'Logging in…';
  authError.classList.add('hidden');

  try {
    await login(baseUrl, username, password);
    passwordInput.value = '';
    await renderAuthState();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    loginBtn.disabled    = false;
    loginBtn.textContent = 'Login';
  }
});

logoutBtn.addEventListener('click', async () => {
  await logout();
  await renderAuthState();
  // If we were connected, the session is now invalid
  if (!disconnectBtn.classList.contains('hidden')) {
    await sendCommand('frieren:disconnect');
    setConnected(false);
  }
});

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────
// Connection section
// ─────────────────────────────────────────────────────────────

connectBtn.addEventListener('click', async () => {
  setConnecting();
  try {
    await sendCommand('frieren:connect');
    // State will update via the 'frieren:state-update' event listener below
  } catch (err) {
    connectionStatusText.textContent = `Error: ${err.message}`;
    setConnected(false);
  }
});

disconnectBtn.addEventListener('click', async () => {
  await sendCommand('frieren:disconnect');
  setConnected(false);
});

// Listen for state updates from the avatar window
listen('frieren:state-update', (event) => {
  const { state, error } = /** @type {{ state: string, error?: string }} */ (event.payload);

  const labels = {
    connected:    'Connected to Fern',
    connecting:   'Connecting…',
    disconnected: 'Disconnected',
    error:        `Error: ${error ?? 'unknown'}`,
  };
  connectionStatusText.textContent = labels[state] ?? state;

  // Update badge
  connectionBadge.className = `badge ${state === 'error' ? 'disconnected' : state}`;
  connectionBadge.textContent = state.charAt(0).toUpperCase() + state.slice(1);

  if (state === 'connected') {
    setConnected(true);
  } else if (state === 'disconnected' || state === 'error') {
    setConnected(false);
  }
});

function setConnecting() {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  connectionStatusText.textContent = 'Connecting to Fern…';
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

// ─────────────────────────────────────────────────────────────
// Avatar / VRM section
// ─────────────────────────────────────────────────────────────

loadVrmBtn.addEventListener('click', async () => {
  try {
    // Open native file picker via Tauri dialog plugin
    const selected = await openDialog({
      title:    'Select VRM Avatar Model',
      filters:  [{ name: 'VRM Model', extensions: ['vrm'] }],
      multiple: false,
    });

    if (!selected) return;   // user cancelled

    const filePath = typeof selected === 'string' ? selected : selected[0];

    // Tell the avatar window to load this model
    await sendCommand('frieren:load-vrm', { path: filePath });

    // Save path so it auto-loads next time
    await setAvatarPath(filePath);

    const fileName = filePath.split(/[/\\]/).pop();
    avatarInfo.textContent = `Loaded: ${fileName}`;
  } catch (err) {
    avatarInfo.textContent = `Failed to load: ${err.message}`;
  }
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Send an event to the avatar (main) window. */
async function sendCommand(eventName, payload = {}) {
  // emitTo sends only to the 'main' label window
  await emitTo('main', eventName, payload);
}

// ─────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────
init();
