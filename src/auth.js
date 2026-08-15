import { storeGet, storeSet, storeDelete } from './electron-ipc.js';

const AUTH_FILE = 'frieren-auth.json';

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
  await storeSet(AUTH_FILE, 'access_token', data.access_token);
  await storeSet(AUTH_FILE, 'refresh_token', data.refresh_token);
  await storeSet(AUTH_FILE, 'base_url', baseUrl);
  return data;
}

export async function register(baseUrl, email, fullName, password) {
  const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, full_name: fullName, password }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registration failed (${res.status}): ${body}`);
  }

  const data = await res.json().catch(() => ({}));

  if (data.access_token && data.refresh_token) {
    await storeSet(AUTH_FILE, 'access_token', data.access_token);
    await storeSet(AUTH_FILE, 'refresh_token', data.refresh_token);
    await storeSet(AUTH_FILE, 'base_url', baseUrl);
  }

  return data;
}

export async function refreshTokens() {
  const refreshToken = await storeGet(AUTH_FILE, 'refresh_token');
  const baseUrl = await storeGet(AUTH_FILE, 'base_url');

  if (!refreshToken || !baseUrl) {
    throw new Error('No refresh token stored, please log in.');
  }

  const res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {

    await logout();
    throw new Error(`Session expired (${res.status}). Please log in again.`);
  }

  const data = await res.json();
  await storeSet(AUTH_FILE, 'access_token', data.access_token);
  await storeSet(AUTH_FILE, 'refresh_token', data.refresh_token);
  return data;
}

export async function getAccessToken() {
  return storeGet(AUTH_FILE, 'access_token');
}

export async function getBaseUrl() {
  return storeGet(AUTH_FILE, 'base_url');
}

export async function isLoggedIn() {
  const token = await getAccessToken();
  return !!token;
}

export async function logout() {
  await storeDelete(AUTH_FILE, 'access_token');
  await storeDelete(AUTH_FILE, 'refresh_token');
}

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
    const { access_token: newToken } = await refreshTokens();
    res = await doRequest(newToken);
  }

  return res;
}

export async function authedUpload(url, formData) {
  const token = await getAccessToken();

  const doRequest = async (tok) =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}` },
      body: formData,
    });

  let res = await doRequest(token);

  if (res.status === 401) {
    const { access_token: newToken } = await refreshTokens();
    res = await doRequest(newToken);
  }

  return res;
}