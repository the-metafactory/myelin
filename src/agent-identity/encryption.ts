/**
 * F-7 FR-9: passphrase-based encryption of the agent identity's
 * private key for at-rest protection.
 *
 * Scheme:
 *   - KDF:     PBKDF2-SHA-256, 600_000 iterations (OWASP 2023 minimum
 *              for SHA-256). 16-byte random salt per file.
 *   - Cipher:  AES-256-GCM. 12-byte random IV (NIST SP 800-38D).
 *              16-byte auth tag (default for GCM in WebCrypto).
 *   - Input:   the base64-encoded Ed25519 private key string (the
 *              same value AgentIdentity.private_key holds in memory).
 *   - Output:  EncryptedPrivateKey envelope serialized to the on-disk
 *              v2 file format.
 *
 * The envelope carries every parameter needed to decrypt — adding a
 * new KDF or cipher later means versioning these fields, not the
 * outer file format, so v2 stays stable.
 */

const KDF_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedPrivateKey {
  scheme: "aes-256-gcm";
  kdf: "pbkdf2-sha256";
  iterations: number;
  /** Base64-encoded random salt fed to PBKDF2. */
  salt: string;
  /** Base64-encoded random IV fed to AES-GCM. */
  iv: string;
  /**
   * Base64-encoded ciphertext + AES-GCM auth tag concatenated, as
   * produced by WebCrypto's `encrypt` call (the tag is appended to
   * the ciphertext, not separate).
   */
  ciphertext: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as ArrayBuffer,
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a base64-encoded private key with a passphrase. Returns the
 * envelope object the on-disk v2 format expects.
 *
 * NOTE: this is a pure crypto primitive. Callers that write the
 * envelope to disk themselves are responsible for setting the file
 * mode to 0o600. The supported path is `saveAgentIdentity(id, path,
 * { passphrase })` which handles encryption + write + chmod together.
 */
export async function encryptPrivateKey(
  privateKeyBase64: string,
  passphrase: string,
): Promise<EncryptedPrivateKey> {
  if (!passphrase) throw new Error("encryptPrivateKey: passphrase is required");
  if (!privateKeyBase64) throw new Error("encryptPrivateKey: privateKey is required");

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, KDF_ITERATIONS);

  const plaintext = new TextEncoder().encode(privateKeyBase64);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as ArrayBuffer }, key, plaintext),
  );

  return {
    scheme: "aes-256-gcm",
    kdf: "pbkdf2-sha256",
    iterations: KDF_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
  };
}

export async function decryptPrivateKey(
  envelope: EncryptedPrivateKey,
  passphrase: string,
): Promise<string> {
  if (!passphrase) throw new Error("decryptPrivateKey: passphrase is required");
  // `scheme`/`kdf` narrow to `never` here; defensive against a value that
  // bypassed the type system (e.g., parsed-untrusted-JSON).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (envelope.scheme !== "aes-256-gcm") {
    throw new Error(`decryptPrivateKey: unsupported cipher '${String(envelope.scheme)}'`);
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (envelope.kdf !== "pbkdf2-sha256") {
    throw new Error(`decryptPrivateKey: unsupported kdf '${String(envelope.kdf)}'`);
  }
  if (!Number.isInteger(envelope.iterations) || envelope.iterations < MIN_LOAD_ITERATIONS) {
    throw new Error(`decryptPrivateKey: iterations must be >= ${MIN_LOAD_ITERATIONS} (got ${envelope.iterations})`);
  }

  // Anti-oracle: catch every failure mode (garbled base64, bad
  // passphrase, tampered ciphertext, KDF error) inside one try and
  // surface a single message. Cycle-1 review caught that base64ToBytes
  // and deriveKey were outside the try, letting `atob` DOMExceptions
  // escape — distinguishable from the post-decrypt error. Fix: wrap
  // the whole chain so the caller cannot tell which step failed.
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const ciphertext = base64ToBytes(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt, envelope.iterations);
    const plaintextBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
      key,
      ciphertext as unknown as ArrayBuffer,
    );
    return new TextDecoder().decode(plaintextBytes);
  } catch {
    throw new Error("decryptPrivateKey: decryption failed (wrong passphrase or tampered file)");
  }
}

/**
 * Minimum acceptable PBKDF2 iteration count when loading an existing
 * encrypted file. Encryption always uses `KDF_ITERATIONS` (600_000),
 * but a file written by an older or compromised producer might claim
 * a lower count — we reject those to prevent KDF downgrade.
 */
export const MIN_LOAD_ITERATIONS = 100_000;

export function isEncryptedPrivateKey(value: unknown): value is EncryptedPrivateKey {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.scheme === "aes-256-gcm" &&
    v.kdf === "pbkdf2-sha256" &&
    typeof v.iterations === "number" &&
    Number.isInteger(v.iterations) &&
    v.iterations >= MIN_LOAD_ITERATIONS &&
    typeof v.salt === "string" &&
    typeof v.iv === "string" &&
    typeof v.ciphertext === "string"
  );
}
