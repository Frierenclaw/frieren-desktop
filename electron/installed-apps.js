import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { getStore } from './store.js';

let _installedAppsCache = null;
let _installedAppsScannedAt = null;
let _appRescanTimer = null;

const NOISE_PATTERNS = [
  'uninstall', 'readme', 'read me', 'changelog', 'license',
  'documentation', 'help', 'website', 'support', 'update',
];

const MATCH_THRESHOLD = 0.55;

function normalizeAppName(raw) {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[™®©]/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function isNoiseEntry(name) {
  const n = name.toLowerCase();
  return NOISE_PATTERNS.some((p) => n.includes(p));
}

function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };
  const aBig = bigrams(a);
  const bBig = bigrams(b);
  let overlap = 0;
  for (const [bg, count] of aBig) {
    if (bBig.has(bg)) overlap += Math.min(count, bBig.get(bg));
  }
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
}

function scoreMatch(query, candidateNormalized) {
  if (candidateNormalized === query) return 1;
  const queryTokens = query.split(' ').filter(Boolean);
  const candTokens = candidateNormalized.split(' ').filter(Boolean);
  const allTokensPresent = queryTokens.length > 0 && queryTokens.every((t) => candTokens.includes(t));
  if (allTokensPresent) return 0.9;
  if (candidateNormalized.includes(query)) return 0.8;
  return diceCoefficient(query, candidateNormalized) * 0.7;
}

async function walkForShortcuts(dir, results) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkForShortcuts(full, results);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.lnk')) continue;
    const name = path.basename(entry.name, '.lnk');
    if (isNoiseEntry(name)) continue;
    try {
      const { target } = shell.readShortcutLink(full);
      if (!target) continue;
      results.push({ name, normalized: normalizeAppName(name), target, kind: 'shortcut' });
    } catch {
      continue;
    }
  }
}

async function scanWindowsApps() {
  const dirs = [
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(app.getPath('appData'), 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
  const results = [];
  for (const dir of dirs) await walkForShortcuts(dir, results);
  return results;
}

async function scanMacApps() {
  const dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  const results = [];
  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.name.toLowerCase().endsWith('.app')) continue;
      const name = path.basename(entry.name, '.app');
      if (isNoiseEntry(name)) continue;
      results.push({ name, normalized: normalizeAppName(name), target: path.join(dir, entry.name), kind: 'bundle' });
    }
  }
  return results;
}

async function scanLinuxApps() {
  const dirs = ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
  const results = [];
  for (const dir of dirs) {
    let fileNames;
    try {
      fileNames = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const fileName of fileNames) {
      if (!fileName.toLowerCase().endsWith('.desktop')) continue;
      const full = path.join(dir, fileName);
      let content;
      try {
        content = await fsp.readFile(full, 'utf8');
      } catch {
        continue;
      }
      if (/^NoDisplay\s*=\s*true/im.test(content)) continue;
      const nameMatch = content.match(/^Name=(.+)$/m);
      if (!nameMatch) continue;
      const name = nameMatch[1].trim();
      if (isNoiseEntry(name)) continue;
      results.push({ name, normalized: normalizeAppName(name), target: full, kind: 'desktop-entry' });
    }
  }
  return results;
}

async function getInstalledApps(forceRescan) {
  if (_installedAppsCache && !forceRescan) return _installedAppsCache;
  const scanner =
    process.platform === 'win32' ? scanWindowsApps :
    process.platform === 'darwin' ? scanMacApps :
    scanLinuxApps;
  _installedAppsCache = await scanner();
  _installedAppsScannedAt = Date.now();
  return _installedAppsCache;
}

function scheduleAppRescan(minutes) {
  if (_appRescanTimer) {
    clearInterval(_appRescanTimer);
    _appRescanTimer = null;
  }
  const ms = Number(minutes) * 60 * 1000;
  if (!ms || ms <= 0) return;
  _appRescanTimer = setInterval(() => {
    getInstalledApps(true).catch(() => {});
  }, ms);
}

export function registerInstalledAppsIpc() {
  ipcMain.handle('list-installed-apps', async (_event, { forceRescan } = {}) => {
    const apps = await getInstalledApps(!!forceRescan);
    return { names: apps.map((a) => a.name), scannedAt: _installedAppsScannedAt };
  });

  ipcMain.handle('set-app-rescan-interval', (_event, minutes) => {
    scheduleAppRescan(minutes);
  });

  ipcMain.handle('launch-app', async (_event, { name } = {}) => {
    const rawQuery = (name ?? '').trim();
    if (!rawQuery) throw new Error('No app name given');
    const query = normalizeAppName(rawQuery);

    const apps = await getInstalledApps(false);
    let best = null;
    let bestScore = 0;
    for (const a of apps) {
      const score = scoreMatch(query, a.normalized);
      if (score > bestScore) {
        bestScore = score;
        best = a;
      }
    }

    if (!best || bestScore < MATCH_THRESHOLD) return { launched: false, reason: 'not_found' };

    await shell.openPath(best.target);
    return { launched: true, name: best.name, matchScore: Number(bestScore.toFixed(2)) };
  });
}

export function initAppRescanTimer() {
  const savedMinutes = getStore('frieren-config.json').get('config')?.appRescanMinutes ?? 0;
  scheduleAppRescan(savedMinutes);
}
