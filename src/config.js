/**
 * config.js Persistent app configuration via the Electron store bridge
 *
 * Stores:
 *   - instances[]    : list of { name, url } Fern instances
 *   - selectedInstance : index into instances[]
 *   - avatarPath     : last loaded VRM file path
 *   - characterId    : selected character UUID
 *   - wakeWords[]    : wake phrases sent to Fern on connect (e.g. "Hey Frieren")
 */

import { storeGet, storeSet } from './electron-ipc.js';

const CONFIG_FILE = 'frieren-config.json';

// Defaults
const DEFAULT_CONFIG = {
  instances: [
    { name: 'Default (frieren.ai)', url: 'https://fern.hereuknow.online/' },
  ],
  selectedInstance: 0,
  avatarPath: null,
  characterId: null,
  wakeWords: ['Hey Frieren'],
};

// Public API

/** Load the full config object, merging with defaults for missing keys. */
export async function getConfig() {
  const stored = await storeGet(CONFIG_FILE, 'config');
  if (!stored) return { ...DEFAULT_CONFIG };
  return { ...DEFAULT_CONFIG, ...stored };
}

/** Persist the full config object. */
export async function saveConfig(config) {
  await storeSet(CONFIG_FILE, 'config', config);
}

/** Returns the URL of the currently selected instance. */
export async function getActiveInstanceUrl() {
  const config = await getConfig();
  const idx = config.selectedInstance ?? 0;
  const url = config.instances?.[idx]?.url ?? DEFAULT_CONFIG.instances[0].url;
  return url.replace(/\/+$/, ''); // strip trailing slash(es)
}

/**
 * Add a new instance and return the updated config.
 * @param {string} name
 * @param {string} url
 */
export async function addInstance(name, url) {
  const config = await getConfig();
  config.instances.push({ name, url });
  await saveConfig(config);
  return config;
}

/**
 * Select a different instance by index.
 * @param {number} idx
 */
export async function setSelectedInstance(idx) {
  const config = await getConfig();
  config.selectedInstance = idx;
  await saveConfig(config);
}

/**
 * Save the path to the last loaded VRM model.
 * @param {string|null} path
 */
export async function setAvatarPath(path) {
  const config = await getConfig();
  config.avatarPath = path;
  await saveConfig(config);
}

export async function setCharacterId(id) {
  const config = await getConfig();
  config.characterId = id;
  await saveConfig(config);
}

// Wake words

/**
 * Returns the stored wake words (always an array).
 * @returns {Promise<string[]>}
 */
export async function getWakeWords() {
  const config = await getConfig();
  return Array.isArray(config.wakeWords) ? config.wakeWords : [];
}

/**
 * Add a wake word if it isn't already present (case-insensitive). Returns the
 * updated list. Empty/whitespace values are ignored.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
export async function addWakeWord(word) {
  const trimmed = (word ?? '').trim();
  if (!trimmed) return getWakeWords();

  const config = await getConfig();
  config.wakeWords = config.wakeWords ?? [];
  const lower = trimmed.toLowerCase();
  if (config.wakeWords.some((w) => w.toLowerCase() === lower)) {
    return config.wakeWords;
  }
  config.wakeWords.push(trimmed);
  await saveConfig(config);
  return config.wakeWords;
}

/**
 * Remove a wake word by exact, case-insensitive match. Returns the updated list.
 * @param {string} word
 * @returns {Promise<string[]>}
 */
export async function removeWakeWord(word) {
  const config = await getConfig();
  const lower = (word ?? '').toLowerCase();
  config.wakeWords = (config.wakeWords ?? []).filter((w) => w.toLowerCase() !== lower);
  await saveConfig(config);
  return config.wakeWords;
}

