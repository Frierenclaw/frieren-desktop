/**
 * auth.js, JWT authentication with auto-refresh for Fern
 *
 * Endpoints (from Heiter):
 *   POST /api/v1/auth/login   { username, password }
 *     -> { access_token, refresh_token }
 *
 *   POST /api/v1/auth/refresh { refresh_token }
 *     -> { access_token, refresh_token }
 *
 * Tokens are stored via the Electron store bridge (electron-store in
 * the main process).
 */

import { storeGet, storeSet, storeDelete } from './electron-ipc.js';

const AUTH_FILE = 'frieren-auth.json';

// Public API

/**
 * Log in with username/password.
 * @param {string} baseUrl - Heiter instance URL
 * @param {string} username
 * @param {string} password
 */
export async function login(baseUrl, username, password) {
  // Heiter uses OAuth2PasswordRequestForm, it rejects a JSON body with 422,
  // so this stays form-urlencoded. Do not change this to JSON.
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  await storeSet(AUTH_FILE, 'access_token', data.access_token);
  await storeSet(AUTH_FILE, 'refresh_token', data.refresh_token);
  await storeSet(AUTH_FILE, 'base_url', baseUrl);
  return data;
}

/**
 * Refresh access + refresh tokens using the stored refresh token.
 * Called automatically by authedFetch on 401.
 */
export async function refreshTokens() {
  const refreshToken = await storeGet(AUTH_FILE, 'refresh_token');
  const baseUrl = await storeGet(AUTH_FILE, 'base_url');

  if (!refreshToken || !baseUrl) {
    throw new Error('No refresh token stored, please log in.');
  }

  // Different endpoint from login, this one takes a JSON body.
  const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    // Refresh token is invalid/expired, the user must re-login
    await logout();
    throw new Error(`Session expired (${res.status}). Please log in again.`);
  }

  const data = await res.json();
  await storeSet(AUTH_FILE, 'access_token', data.access_token);
  await storeSet(AUTH_FILE, 'refresh_token', data.refresh_token);
  return data;
}

/** Read the stored access token (may be null). */
export async function getAccessToken() {
  return storeGet(AUTH_FILE, 'access_token');
}

/** Read the stored base URL (may be null). */
export async function getBaseUrl() {
  return storeGet(AUTH_FILE, 'base_url');
}

/** True if an access token is saved. */
export async function isLoggedIn() {
  const token = await getAccessToken();
  return !!token;
}

/** Clear all stored tokens. */
export async function logout() {
  await storeDelete(AUTH_FILE, 'access_token');
  await storeDelete(AUTH_FILE, 'refresh_token');
}

/**
 * Authenticated fetch, adds a Bearer header.
 * On 401, attempts one token refresh and retries.
 * Throws if refresh fails too.
 *
 * @param {string} url
 * @param {RequestInit} options
 */
export async function authedFetch(url, options = {}) {
  const token = await getAccessToken();

  const doRequest = async (tok) =>
    fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: `Bearer ${tok}`,
      },
    });

  let res = await doRequest(token);

  if (res.status === 401) {
    const { access_token: newToken } = await refreshTokens(); // throws if it can't refresh
    res = await doRequest(newToken);
  }

  return res;
}