/**
 * auth.js — JWT authentication + auto-refresh for Heiter
 *
 * Endpoints (from neadond):
 *   POST /api/v1/auth/login   { username, password }
 *     → { access_token, refresh_token }
 *
 *   POST /api/v1/auth/refresh { refresh_token }
 *     → { access_token, refresh_token }
 *
 * Tokens are stored securely in tauri-plugin-store.
 */

import { load } from '@tauri-apps/plugin-store';

/** @type {import('@tauri-apps/plugin-store').Store | null} */
let _store = null;

async function getStore() {
  if (!_store) {
    _store = await load('frieren-auth.json', { autoSave: true });
  }
  return _store;
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Log in with username/password.
 * @param {string} baseUrl - Heiter instance URL
 * @param {string} username
 * @param {string} password
 */
export async function login(baseUrl, username, password) {
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
  const s = await getStore();
  await s.set('access_token',  data.access_token);
  await s.set('refresh_token', data.refresh_token);
  await s.set('base_url',      baseUrl);
  return data;
}

/**
 * Refresh access + refresh tokens using the stored refresh token.
 * Called automatically by authedFetch on 401.
 */
export async function refreshTokens() {
  const s = await getStore();
  const refreshToken = await s.get('refresh_token');
  const baseUrl      = await s.get('base_url');

  if (!refreshToken || !baseUrl) {
    throw new Error('No refresh token stored — please log in.');
  }

  const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    // Refresh token is invalid/expired — user must re-login
    await logout();
    throw new Error(`Session expired (${res.status}). Please log in again.`);
  }

  const data = await res.json();
  await s.set('access_token',  data.access_token);
  await s.set('refresh_token', data.refresh_token);
  return data;
}

/** Read the stored access token (may be null). */
export async function getAccessToken() {
  const s = await getStore();
  return /** @type {string|null} */ (await s.get('access_token'));
}

/** Read the stored base URL (may be null). */
export async function getBaseUrl() {
  const s = await getStore();
  return /** @type {string|null} */ (await s.get('base_url'));
}

/** True if an access token is saved. */
export async function isLoggedIn() {
  const token = await getAccessToken();
  return !!token;
}

/** Clear all stored tokens. */
export async function logout() {
  const s = await getStore();
  await s.delete('access_token');
  await s.delete('refresh_token');
}

/**
 * Authenticated fetch — adds Bearer header.
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
    const { access_token: newToken } = await refreshTokens(); // throws if can't refresh
    res = await doRequest(newToken);
  }

  return res;
}
