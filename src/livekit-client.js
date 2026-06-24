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
let _onAudioReadyCb  = null;  // fired once audio playback is unblocked

export function onViseme(cb)      { _onVisemeCb = cb; }
export function onStateChange(cb) { _onStateChangeCb = cb; }
export function onError(cb)       { _onErrorCb = cb; }

/**
 * Register a callback invoked once audio playback is confirmed unblocked
 * (i.e. Chromium's autoplay policy has been satisfied by a user gesture).
 * @param {() => void} cb
 */
export function onAudioReady(cb) { _onAudioReadyCb = cb; }

// ── Audio unblock ──────────────────────────────────────────────
// WebView2/Chromium requires a user gesture before audio can play.
// LiveKit's Room.startAudio() attempts to unmute the AudioContext and
// resume any suspended <audio> elements. We call it after connect, on
// every AudioPlaybackStatusChanged event, and expose tryUnblockAudio
// so main.js can wire it to a canvas click as a fallback gesture.

export function tryUnblockAudio() {
  if (_room?.canPlaybackAudio) return false; // already unblocked
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

// ── Room token ────────────────────────────────────────────────

async function getSessionToken() {
  const baseUrl = await getBaseUrl();
  if (!baseUrl) throw new Error('No server URL configured. Please log in first.');

  const config = await getConfig();
  if (!config.characterId) throw new Error('No character selected. Please select a character in settings.');

  // Fern's CreateRoomDTO expects a JSON body:
  //   { "character_id": <uuid>, "wake_words": [...] }
  // wake_words drives the WakePhraseUserTurnStartStrategy in the bot pipeline,
  // so the bot won't start listening until a phrase is spoken.
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
    // Attempt to unblock audio immediately after connecting.
    // This succeeds when the page already has a user gesture context.
    _room.startAudio();
  });

  _room.on(RoomEvent.Disconnected, (reason) => {
    const state = reason === DisconnectReason.CLIENT_INITIATED ? 'disconnected' : 'error';
    _emitState(state);
    _room = null;
  });

  _room.on(RoomEvent.Reconnecting, () => {
    _emitState('connecting');
  });

  _room.on(RoomEvent.Reconnected, () => {
    _emitState('connected');
  });

  // Chromium fires this when autoplay policy changes (e.g. after a click).
  // If playback becomes allowed, notify the avatar window.
  _room.on(RoomEvent.AudioPlaybackStatusChanged, _handleAudioStatusChanged);

  _room.on(RoomEvent.DataReceived, (payload) => {
    try {
      const text = new TextDecoder().decode(payload);
      const data = JSON.parse(text);
      if (data.type === 'vrm_viseme' && _onVisemeCb) {
        _onVisemeCb(data);
      }
    } catch {
      // Non-JSON or unknown payload
    }
  });

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
