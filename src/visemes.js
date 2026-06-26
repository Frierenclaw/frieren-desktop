// Viseme mapping for the Frieren ecosystem.
//
// Fern (backend) already resolves each spoken word to a VRM expression name
// (see api/v1/bot/viseme_processor.py: CHAR_TO_VRM) and pushes it over the
// LiveKit data channel as:
//
//     { "type": "vrm_viseme", "viseme": "aa" | "ih" | "ou" | "ee" | "oh" | "neutral" }
//
// The client therefore does no phoneme mapping itself — it only validates the
// incoming name and blends it onto the avatar. Most VRM models expose just the
// five universal vowel expressions; phoneme expressions (pp, ff, th…) only
// exist in VRM 1.0 models, so we stick to the vowels for portability.

// Universal VRM mouth expressions. Iterated in declaration order during smoothing.
export const MOUTH_EXPRESSIONS = ['aa', 'ih', 'ou', 'ee', 'oh'];

// Set form for O(1) membership checks.
export const VRM_VISEME_NAMES = new Set(MOUTH_EXPRESSIONS);

// Returns true when `name` is a mouth expression the renderer can drive.
export function isValidViseme(name) {
  return typeof name === 'string' && VRM_VISEME_NAMES.has(name);
}
