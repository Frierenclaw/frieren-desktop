/**
 * ui-instance.js, "Instance" card
 */

import { getConfig, addInstance, setSelectedInstance, setCharacterId } from './config.js';
import { $ } from './ui-shared.js';
import { updateConnectAvailability } from './ui-connect-gate.js';

const instanceSelect    = $('instance-select');
const addInstanceBtn    = $('add-instance-btn');
const addInstanceForm   = $('add-instance-form');
const newInstanceName   = $('new-instance-name');
const newInstanceUrl    = $('new-instance-url');
const saveInstanceBtn   = $('save-instance-btn');
const cancelInstanceBtn = $('cancel-instance-btn');

export async function renderInstances() {
  const config = await getConfig();
  instanceSelect.innerHTML = '';

  config.instances.forEach((inst, i) => {
    const opt       = document.createElement('option');
    opt.value        = String(i);
    opt.textContent  = inst.name;
    instanceSelect.appendChild(opt);
  });

  instanceSelect.value = String(config.selectedInstance ?? 0);
}

export function initInstanceSection() {
  instanceSelect.addEventListener('change', async () => {
    await setSelectedInstance(Number(instanceSelect.value));
    await setCharacterId(null);
    await updateConnectAvailability();
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
      alert('Invalid URL, please include https://');
      return;
    }

    const updatedConfig = await addInstance(name, url);
    await setSelectedInstance(updatedConfig.instances.length - 1);
    await setCharacterId(null);
    await updateConnectAvailability();
    await renderInstances();
    addInstanceForm.classList.add('hidden');
    newInstanceName.value = '';
    newInstanceUrl.value  = '';
  });

  return renderInstances();
}
