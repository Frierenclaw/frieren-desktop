// Maps edge-tts viseme IDs (0–21) to the 5 universal VRM vowel expressions.
// Most VRM models only have aa/ih/ou/ee/oh — phoneme expressions (pp, ff, th...)
// only exist in VRM 1.0 models. Mapping to vowels gives visible lip movement on any model.
export const EDGE_TTS_VISEME_MAP = {
  0:  null,   // Silence → neutral
  1:  'aa',   // æ, ə, ʌ  — "bat", "but"
  2:  'aa',   // ɑː        — "father"
  3:  'oh',   // ɔː        — "ball"
  4:  'ee',   // eɪ, ɛ    — "day", "bed"
  5:  'ih',   // ɜː        — "bird"
  6:  'ih',   // ɪ, iː    — "bit", "beat"
  7:  'ou',   // uː, w    — "boot"
  8:  'ou',   // oʊ        — "boat"
  9:  'aa',   // aʊ        — "house"
  10: 'oh',   // ɔɪ        — "boy"
  11: 'aa',   // aɪ        — "bite"
  12: null,   // h
  13: null,   // r
  14: null,   // l
  15: null,   // s, z
  16: null,   // sh, ch, j
  17: null,   // th, dh
  18: null,   // f, v
  19: null,   // d, t, n
  20: null,   // k, g, ng
  21: 'aa',   // p, b, m — slight open
};

export const MOUTH_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh'];