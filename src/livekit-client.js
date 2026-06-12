import {
  Room,
  RoomEvent,
  ConnectionState,
  DisconnectReason,
} from 'livekit-client';
import { authedFetch, getBaseUrl } from './auth.js';
import { getConfig } from './config.js';

let _room = null;
let _onVisemeCb      = null;
let _onStateChangeCb = null;
let _onErrorCb       = null;

export function onViseme(cb)      { _onVisemeCb = cb; }
export function onStateChange(cb) { _onStateChangeCb = cb; }
export function onError(cb)       { _onErrorCb = cb; }

async function getSessionToken() {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('No server URL configured. Please log in first.');

  const config = await getConfig();
  if (!config.characterId) throw new Error('No character selected. Please select a character in settings.');

  const res = await authedFetch(`${baseUrl}/api/v1/room/?character_id=${config.characterId}`, {
    method: 'POST',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to get session token (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    livekitUrl: data.livekit_url,
    token:      data.token,
  };
}

export async function connect() {
  if (_room) await disconnect();

  _emitState('connecting');

  const { livekitUrl, token } = await getSessionToken();

  _room = new Room({
    adaptiveStream: true,
    dynacast:       true,
    reconnectPolicy: {
      nextRetryDelayInMs(context) {
        return Math.min(context.retryCount * 1000, 10_000);
      },
    },
  });

  _room.on(RoomEvent.Connected, () => {
    _emitState('connected');
  });

  _room.on(RoomEvent.Disconnected, (reason) => {
    const state = reason === DisconnectReason.UNKNOWN_REASON ? 'error' : 'disconnected';
    _emitState(state);
    _room = null;
  });

  _room.on(RoomEvent.Reconnecting, () => {
    _emitState('connecting');
  });

  _room.on(RoomEvent.Reconnected, () => {
    _emitState('connected');
  });

  _room.on(RoomEvent.DataReceived, (payload) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);
      if (data.type === 'viseme' && _onVisemeCb) {
        _onVisemeCb(data);
      }
    } catch {
      // Non-JSON or unknown payload
    }
  });

  await _room.connect(livekitUrl, token);
  await _room.localParticipant.setMicrophoneEnabled(true);
}

export async function disconnect() {
  if (_room) {
    await _room.disconnect();
    _room = null;
  }
  _emitState('disconnected');
}

export function isConnected() {
  return _room?.state === ConnectionState.Connected;
}

function _emitState(state) {
  _onStateChangeCb?.(state);
}