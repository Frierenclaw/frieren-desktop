import {
  Room,
  RoomEvent,
  ConnectionState,
  DisconnectReason,
  Track,
} from 'livekit-client';
import { authedFetch, getBaseUrl } from './auth.js';
import { getConfig, getWakeWords } from './config.js';

// ── Module state ──────────────────────────────────────────────
let _room = null;
let _onVisemeCb      = null;
let _onStateChangeCb = null;
let _onErrorCb       = null;
let _onAudioReadyCb  = null;

export function onViseme(cb)      { _onVisemeCb = cb; }
export function onStateChange(cb) { _onStateChangeCb = cb; }
export function onError(cb)       { _onErrorCb = cb; }
export function onAudioReady(cb)  { _onAudioReadyCb = cb; }

// ── Audio unblock ──────────────────────────────────────────────
export function tryUnblockAudio() {
  if (_room?.canPlaybackAudio) return false;
  _room?.startAudio();
  return true;
}

export function canPlaybackAudio() {
  return !!_room?.canPlaybackAudio;
}

function _handleAudioStatusChanged(playable) {
  if (playable) {
    _onAudioReadyCb?.();
  }
}

// ── Viseme dispatch ───────────────────────────────────────────
function _dispatchViseme(data) {
  if (data.type === 'vrm_viseme') {
    console.debug('[viseme] ▶ received', data);
    if (_onVisemeCb) {
      _onVisemeCb(data);
    } else {
      console.warn('[viseme] No viseme callback registered; message dropped');
    }
  } else if (data.type === 'viseme') {
    console.warn('[viseme] Received legacy type "viseme" (expected "vrm_viseme"):', data);
  } else {
    console.debug('[viseme] Non-viseme data message (type=%s):', data.type, data);
  }
}

// ── Room token ────────────────────────────────────────────────
async function getSessionToken() {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('No server URL configured. Please log in first.');

  const config = await getConfig();
  if (!config.characterId) throw new Error('No character selected. Please select a character in settings.');

  const wakeWords = await getWakeWords();
  const res = await authedFetch(`${baseUrl}/api/v1/room/`, {
    method: 'POST',
    body: JSON.stringify({
      character_id: config.characterId,
      wake_words:   wakeWords,
    }),
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

// ── Connect / disconnect ───────────────────────────────────────
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
    _room.startAudio();
  });

  _room.on(RoomEvent.Disconnected, (reason) => {
    const state = reason === DisconnectReason.CLIENT_INITIATED ? 'disconnected' : 'error';
    _emitState(state);
    _room = null;
  });

  _room.on(RoomEvent.Reconnecting, () => _emitState('connecting'));
  _room.on(RoomEvent.Reconnected,  () => _emitState('connected'));

  _room.on(RoomEvent.AudioPlaybackStatusChanged, _handleAudioStatusChanged);

  // ── v2.x DataReceived: (payload, participant, kind, topic) ────
  // Fires only for messages published WITHOUT a topic (or with topic=undefined).
  // If Fern sends with a topic, this won't fire, see stream handlers below.
  _room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    console.debug('[livekit] DataReceived fired; topic:', topic ?? '(none)', 'kind:', kind, 'from:', participant?.identity ?? 'unknown');

    const text = new TextDecoder().decode(payload);
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.warn('[viseme] DataReceived: non-JSON payload:', text.slice(0, 200));
      return;
    }
    _dispatchViseme(data);
  });

  // ── v2.x topic-based stream handlers ─────────────────────────
  // If Fern publishes with topic="vrm_viseme", DataReceived is silent.
  // registerTextStreamHandler / registerDataStreamHandler handle it instead.

  // Text stream (publishData with topic, string payload)
  if (typeof _room.registerTextStreamHandler === 'function') {
    _room.registerTextStreamHandler('vrm_viseme', async (reader, participantInfo) => {
      console.debug('[viseme] TextStream opened for topic "vrm_viseme" from', participantInfo?.identity);
      try {
        for await (const chunk of reader) {
          console.debug('[viseme] TextStream chunk:', chunk);
          let data;
          try { data = JSON.parse(chunk); } catch { data = { type: 'vrm_viseme', raw: chunk }; }
          _dispatchViseme(data);
        }
      } catch (err) {
        console.warn('[viseme] TextStream error:', err);
      }
    });
  } else {
    console.warn('[viseme] registerTextStreamHandler not available; LiveKit client may be too old');
  }

  // Binary/data stream (publishData with topic, Uint8Array payload)
  if (typeof _room.registerDataStreamHandler === 'function') {
    _room.registerDataStreamHandler('vrm_viseme', async (reader, participantInfo) => {
      console.debug('[viseme] DataStream opened for topic "vrm_viseme" from', participantInfo?.identity);
      try {
        for await (const chunk of reader) {
          const text = new TextDecoder().decode(chunk);
          console.debug('[viseme] DataStream chunk:', text);
          let data;
          try { data = JSON.parse(text); } catch { console.warn('[viseme] DataStream: non-JSON chunk:', text); return; }
          _dispatchViseme(data);
        }
      } catch (err) {
        console.warn('[viseme] DataStream error:', err);
      }
    });
  } else {
    console.warn('[viseme] registerDataStreamHandler not available; LiveKit client may be too old');
  }

  _room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind === Track.Kind.Audio) {
      const audioElement = track.attach();
      audioElement.id = `livekit-audio-${participant.sid}`;
      document.body.appendChild(audioElement);
    }
  });

  _room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach().forEach(el => el.remove());
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