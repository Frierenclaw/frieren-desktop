/**
 * visemes.js — Maps Fern's viseme IDs to VRM expression names
 *
 * Fern uses edge-tts for TTS, which outputs Microsoft SSML viseme IDs (0–21).
 * These are mapped to @pixiv/three-vrm expression names so the avatar's mouth
 * moves in sync with the speech audio.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
 */

/**
 * Maps edge-tts viseme IDs (0–21) → VRM expression names.
 * VRM expression names follow the VRM 1.0 spec blendshape presets.
 *
 * @type {Record<number, string>}
 */
export const EDGE_TTS_VISEME_MAP = {
  0:  'neutral', // Silence / rest position
  1:  'aa',      // æ, ə, ʌ   — "bat", "but"
  2:  'aa',      // ɑː         — "father"
  3:  'oh',      // ɔː         — "ball"
  4:  'e',       // eɪ, ɛ, ʊ  — "day", "bed"
  5:  'ih',      // ɜː         — "bird"
  6:  'ih',      // ɪ, iː      — "bit", "beat"
  7:  'ou',      // uː, w      — "boot", "web"
  8:  'ou',      // oʊ         — "boat"
  9:  'aa',      // aʊ         — "house"
  10: 'oh',      // ɔɪ         — "boy"
  11: 'aa',      // aɪ         — "bite"
  12: 'neutral', // h          — aspiration
  13: 'rr',      // r          — "red"
  14: 'nn',      // l          — "leg"
  15: 'ss',      // s, z       — "sit", "zip"
  16: 'ch',      // ʃ, tʃ, dʒ  — "she", "chip", "judge"
  17: 'th',      // θ, ð       — "thin", "this"
  18: 'ff',      // f, v       — "far", "van"
  19: 'dd',      // d, t, n    — "dog", "tip", "net"
  20: 'kk',      // k, g, ŋ   — "cat", "go", "sing"
  21: 'pp',      // p, b, m    — "put", "bed", "map"
};

/**
 * All mouth-related VRM expressions that should be reset between visemes.
 * Neutral/blink/etc are excluded intentionally so they keep their own state.
 */
export const MOUTH_EXPRESSIONS = [
  'aa', 'ih', 'ou', 'ee', 'oh',  // vowels
  'pp', 'ff', 'th', 'dd', 'kk',  // plosives / fricatives
  'ch', 'ss', 'nn', 'rr',        // affricates / resonants
];
