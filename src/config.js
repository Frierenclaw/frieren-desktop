import { load } from "@tauri-apps/plugin-store";

const STORE_FILE = "frieren.json";
const DEFAULT_FERN_URL = "http://localhost:8000";

let store = null;

async function getStore() {
  if (!store) {
    store = await load(STORE_FILE, { autoSave: true });
  }
  return store;
}

export async function getFernUrl() {
  const s = await getStore();
  return (await s.get("fern_url")) || DEFAULT_FERN_URL;
}

export async function setFernUrl(url) {
  const s = await getStore();
  await s.set("fern_url", url);
}

export async function getTokens() {
  const s = await getStore();
  return {
    accessToken: await s.get("access_token"),
    refreshToken: await s.get("refresh_token"),
  };
}

export async function setTokens(accessToken, refreshToken) {
  const s = await getStore();
  await s.set("access_token", accessToken);
  await s.set("refresh_token", refreshToken);
}

export async function clearTokens() {
  const s = await getStore();
  await s.delete("access_token");
  await s.delete("refresh_token");
}