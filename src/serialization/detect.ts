import type { CodecId } from "./types";

/**
 * F-3: best-effort wire-format detection. Returns the codec id implied
 * by the first bytes of `data`, or null when the bytes are ambiguous.
 *
 * Detection rules:
 *   - JSON: first non-whitespace byte is `{`. JSON's strict grammar
 *     guarantees an envelope object starts with `{`, so this is robust
 *     against any UTF-8 leading whitespace and against MessagePack's
 *     binary header (whose first byte is rarely `{` — see msgpack
 *     spec: fixmap is 0x80-0x8f, str is 0xa0-0xbf, etc., none of which
 *     overlap with ASCII `{` = 0x7b).
 *   - MessagePack: first byte indicates a fixmap, map16, or map32 header
 *     (0x80-0x8f, 0xde, 0xdf). Envelopes are objects, so the wire form
 *     is always a map.
 *   - Unknown: returns null. Caller decides whether to treat as JSON
 *     (default historical behavior) or to error out strictly.
 *
 * MessagePack envelopes carry `extensions.codec = "msgpack"` once
 * decoded; first-byte detection is a fast pre-decode check, not a
 * security boundary. Strict subscribers should still cross-check the
 * decoded extensions field.
 */
export function detectCodec(data: Uint8Array): CodecId | null {
  let i = 0;
  // Skip ASCII whitespace prefix (only valid in JSON; MessagePack data
  // never starts with whitespace bytes).
  while (i < data.length) {
    const b = data[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) break;
    i++;
  }
  if (i >= data.length) return null;
  const head = data[i];
  if (head === 0x7b /* { */) return "json";
  // MessagePack fixmap (0x80–0x8f), map16 (0xde), map32 (0xdf).
  if ((head >= 0x80 && head <= 0x8f) || head === 0xde || head === 0xdf) return "msgpack";
  return null;
}
