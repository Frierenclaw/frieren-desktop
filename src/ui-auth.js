import { login, register, logout, isLoggedIn, getBaseUrl } from './auth.js';
import { getActiveInstanceUrl, setCharacterId } from './config.js';
import { $ } from './ui-shared.js';
import { updateConnectAvailability } from './ui-connect-gate.js';
import { disconnectIfConnected } from './ui-connection.js';
import { loadCharacters } from './ui-characters.js';
import { renderUploadAvailability } from './ui-upload.js';

const loginForm     = $('login-form');
const usernameInput = $('username');
const passwordInput = $('password');
const loginBtn       = $('login-btn');
const authError      = $('auth-error');

const registerForm           = $('register-form');
const registerFullNameInput  = $('register-full-name');
const registerEmailInput     = $('register-email');
const registerPasswordInput  = $('register-password');
const registerConfirmInput   = $('register-password-confirm');
const registerBtn            = $('register-btn');
const registerError          = $('register-error');
const showRegisterLink       = $('show-register-link');
const showLoginLink          = $('show-login-link');

const loggedInView   = $('logged-in-view');
const authInfo       = $('auth-info');
const logoutBtn      = $('logout-btn');

function showAuthError(msg) {
  authError.textContent = msg;
  authError.classList.remove('hidden');
}

function showRegisterError(msg) {
  registerError.textContent = msg;
  registerError.classList.remove('hidden');
}

function switchToRegister() {
  authError.classList.add('hidden');
  loginForm.classList.add('hidden');
  registerForm.classList.remove('hidden');
}

function switchToLogin() {
  registerError.classList.add('hidden');
  registerForm.classList.add('hidden');
  loginForm.classList.remove('hidden');
}

export async function renderAuthState() {
  const loggedIn = await isLoggedIn();

  if (loggedIn) {
    loginForm.classList.add('hidden');
    registerForm.classList.add('hidden');
    loggedInView.classList.remove('hidden');
    const baseUrl = await getBaseUrl();
    authInfo.textContent = `Logged in to ${baseUrl}`;
  } else {
    loggedInView.classList.add('hidden');
    if (loginForm.classList.contains('hidden') && registerForm.classList.contains('hidden')) {
      loginForm.classList.remove('hidden');
    }
  }

  await updateConnectAvailability();
  await renderUploadAvailability();
}

export function initAuthSection() {
  loginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const baseUrl  = await getActiveInstanceUrl();

    if (!username || !password) {
      showAuthError('Email and password are required.');
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

  showRegisterLink.addEventListener('click', (e) => { e.preventDefault(); switchToRegister(); });
  showLoginLink.addEventListener('click', (e) => { e.preventDefault(); switchToLogin(); });

  registerBtn.addEventListener('click', async () => {
    const fullName = registerFullNameInput.value.trim();
    const email    = registerEmailInput.value.trim();
    const password = registerPasswordInput.value;
    const confirm  = registerConfirmInput.value;
    const baseUrl  = await getActiveInstanceUrl();

    registerError.classList.add('hidden');

    if (!fullName || !email || !password) {
      showRegisterError('Name, email, and password are required.');
      return;
    }
    if (password !== confirm) {
      showRegisterError('Passwords do not match.');
      return;
    }

    registerBtn.disabled    = true;
    registerBtn.textContent = 'Creating account...';

    try {
      const data = await register(baseUrl, email, fullName, password);

      registerPasswordInput.value = '';
      registerConfirmInput.value  = '';

      if (data.access_token) {
        await renderAuthState();
        await loadCharacters();
      } else {
        switchToLogin();
        usernameInput.value = email;
      }
    } catch (err) {
      showRegisterError(err.message);
    } finally {
      registerBtn.disabled    = false;
      registerBtn.textContent = 'Create account';
    }
  });

  logoutBtn.addEventListener('click', async () => {
    await logout();
    await setCharacterId(null);
    await renderAuthState();
    await loadCharacters();
    disconnectIfConnected();
  });

  return renderAuthState();
}