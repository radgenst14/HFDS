/**
 * State hash for the replay / determinism test (doc 13 §11, doc 17 M1).
 * FNV-1a over a canonical JSON string; two independent 32-bit lanes for fewer collisions.
 */
export function hashString(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** JSON with numbers rounded to 1e-9 so -0 and float noise in printing cannot differ. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'number' ? (Object.is(v, -0) ? 0 : Math.round(v * 1e9) / 1e9) : v,
  );
}
