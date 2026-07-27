/**
 * ui-auth.js, "Account" card
 */

import { login, logout, isLoggedIn, getBaseUrl } from './auth.js';
import { getActiveInstanceUrl, setCharacterId } from './config.js';
import { $ } from './ui-shared.js';
import { updateConnectAvailability } from './ui-connect-gate.js';
import { disconnectIfConnected } from './ui-connection.js';
import { loadCharacters } from './ui-characters.js';

const loginForm     = $('login-form');
const usernameInput = $('username');
const passwordInput = $('password');
const loginBtn       = $('login-btn');
const authError      = $('auth-error');
const loggedInView   = $('logged-in-view');
const authInfo       = $('auth-info');
const logoutBtn      = $('logout-btn');

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

export async function renderAuthState() {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    loginForm.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    const baseUrl = await getBaseUrl();
    authInfo.textContent = `Logged in to ${baseUrl}`;
  } else {
    loginForm.classList.remove('hidden');
    loggedInView.classList.add('hidden');
  }

  // Not-logged-in is also handled inside updateConnectAvailability (it
  // disables the button and clears the tooltip), so this covers both branches.
  await updateConnectAvailability();
}

export function initAuthSection() {
  loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const baseUrl  = await getActiveInstanceUrl();

    if (!username || !password) {
      showAuthError('Username and password are required.');
      return;
    }

    loginBtn.disabled    = true;
    loginBtn.textContent = 'Logging in...';
    authError.classList.add('hidden');

    try {
      await login(baseUrl, username, password);
      passwordInput.value = '';
      await renderAuthState();
      await loadCharacters();
    } catch (err) {
      showAuthError(err.message);
    } finally {
      loginBtn.disabled    = false;
      loginBtn.textContent = 'Login';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await logout();
    await setCharacterId(null);
    await renderAuthState();
    await loadCharacters();
    // If we were connected, the session is now invalid
    disconnectIfConnected();
  });

  return renderAuthState();
}
