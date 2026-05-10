/**
 * Single source of truth for base64 byte/string conversion across the
 * crypto surface (envelope signing, capability advertisement signing,
 * bid response signing). Bun's Buffer is the consistent runtime path —
 * keeping conversions in one place avoids API drift when the runtime
 * target ever changes.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function bytesFromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
