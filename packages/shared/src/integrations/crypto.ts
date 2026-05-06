/**
 * Token encryption — AES-256-GCM envelope encryption for OAuth tokens.
 *
 * Protects against database compromise: tokens are encrypted before storage,
 * decryption key lives only in env vars (Vercel encrypts at rest separately).
 *
 * Format: base64(iv || ciphertext || authTag) — single string, easy to store as TEXT.
 *
 * Backward compatible: if a stored value isn't in our format, returns it as-is
 * (so existing plain-text tokens still work until they're refreshed).
 */

const ENCRYPTION_KEY_ENV = 'TOKEN_ENCRYPTION_KEY';
const PREFIX = 'enc:'; // marker so we know if a value is encrypted
const ALGO = 'AES-GCM';
const IV_LENGTH = 12; // 96 bits, recommended for GCM

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;

  const keyB64 = process.env[ENCRYPTION_KEY_ENV];
  if (!keyB64) {
    console.warn(`[crypto] ${ENCRYPTION_KEY_ENV} not set — tokens will be stored in plain text`);
    return null;
  }

  try {
    const keyBytes = Buffer.from(keyB64, 'base64');
    if (keyBytes.length !== 32) {
      console.error(`[crypto] ${ENCRYPTION_KEY_ENV} must be 32 bytes (256-bit) base64-encoded`);
      return null;
    }

    cachedKey = await crypto.subtle.importKey('raw', keyBytes, { name: ALGO }, false, ['encrypt', 'decrypt']);
    return cachedKey;
  } catch (err) {
    console.error('[crypto] Failed to import key:', err);
    return null;
  }
}

/**
 * Encrypt a string. Returns the original value if encryption is disabled.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  const key = await getKey();
  if (!key) return plaintext;

  try {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

    // Pack iv || ciphertext into a single base64 string with our prefix
    const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipherBuf), iv.length);

    return PREFIX + Buffer.from(combined).toString('base64');
  } catch (err) {
    console.error('[crypto] Encryption failed:', err);
    return plaintext;
  }
}

/**
 * Decrypt a string. Returns the input as-is if it isn't in our encrypted format.
 */
export async function decryptToken(value: string): Promise<string> {
  if (!value || !value.startsWith(PREFIX)) return value;

  const key = await getKey();
  if (!key) {
    console.error('[crypto] Cannot decrypt — encryption key not configured');
    return value;
  }

  try {
    const combined = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = combined.subarray(0, IV_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH);

    const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuf);
  } catch (err) {
    console.error('[crypto] Decryption failed:', err);
    return value;
  }
}
