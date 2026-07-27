/**
 * ui-microphone.js, "Microphone" card
 */

import { Room } from 'livekit-client';
import { $, sendCommand } from './ui-shared.js';
import { getAudioInputDeviceId, setAudioInputDeviceId } from './config.js';

const audioInputSelect = $('audio-input-select');
const audioInputStatus = $('audio-input-status');

async function renderAudioInputDevices() {
  try {
    const devices  = await Room.getLocalDevices('audioinput', true);
    const savedId  = await getAudioInputDeviceId();

    audioInputSelect.innerHTML = '';

    if (devices.length === 0) {
      audioInputStatus.textContent = 'No microphones found.';
      return;
    }

    devices.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Microphone (${d.deviceId.slice(0, 6)})`;
      audioInputSelect.appendChild(opt);
    });

    const stillPresent = savedId && devices.some((d) => d.deviceId === savedId);
    audioInputSelect.value = stillPresent ? savedId : devices[0].deviceId;
    audioInputStatus.textContent = '';
  } catch (err) {
    audioInputStatus.textContent = `Couldn't list microphones: ${err.message}`;
  }
}

export function initMicrophoneSection() {
  audioInputSelect.addEventListener('change', async () => {
    const deviceId = audioInputSelect.value;
    await setAudioInputDeviceId(deviceId);
    sendCommand('frieren:set-audio-device', { deviceId });
  });

  navigator.mediaDevices?.addEventListener?.('devicechange', renderAudioInputDevices);

  return renderAudioInputDevices();
}
