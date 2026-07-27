/**
 * ui-installed-apps.js, "Installed Apps" card
 */

import { $ } from './ui-shared.js';
import { listInstalledApps } from './electron-ipc.js';
import { getAppRescanMinutes, setAppRescanMinutes } from './config.js';

const installedAppsStatus     = $('installed-apps-status');
const rescanAppsBtn           = $('rescan-apps-btn');
const appRescanIntervalSelect = $('app-rescan-interval-select');

function renderInstalledAppsInfo({ names, scannedAt }) {
  if (!scannedAt) {
    installedAppsStatus.textContent = 'Not scanned yet';
    return;
  }
  const when = new Date(scannedAt).toLocaleTimeString();
  installedAppsStatus.textContent = `${names.length} app(s) found (last scanned ${when})`;
}

async function refreshInstalledApps(forceRescan) {
  installedAppsStatus.textContent = forceRescan ? 'Rescanning…' : 'Loading…';
  try {
    const info = await listInstalledApps(forceRescan);
    renderInstalledAppsInfo(info);
  } catch (err) {
    installedAppsStatus.textContent = `Error: ${err.message}`;
  }
}

export async function initInstalledAppsSection() {
  const savedMinutes = await getAppRescanMinutes();
  appRescanIntervalSelect.value = String(savedMinutes);

  rescanAppsBtn.addEventListener('click', () => refreshInstalledApps(true));

  appRescanIntervalSelect.addEventListener('change', async () => {
    await setAppRescanMinutes(Number(appRescanIntervalSelect.value));
  });

  await refreshInstalledApps(false);
}
