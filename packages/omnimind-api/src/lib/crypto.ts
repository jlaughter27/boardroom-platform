import crypto from 'crypto';
import { logger } from './logger';

/**
 * AES-256-GCM helpers for OAuth tokens and ministry-domain memory content.
 *
 * AUDIT-2026-10-02 hardening:
 *   F-108 — ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars). In
 *           production a missing/malformed key is fatal (validateEncryptionKey
 *           runs at startup) and encrypt()/decrypt() never pass plaintext
 *           through. The dev/test passthrough is preserved ONLY outside
 *           production so local workflows without a key keep working.
 *   F-109 — decrypt() THROWS on GCM auth-tag failure (tampered / corrupt
 *           ciphertext, wrong key). It never returns the ciphertext as if it
 *           were plaintext. Legacy plaintext (values that do not have the
 *           iv:tag:ciphertext hex shape) still passes through for migration
 *           safety.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

export class CryptoError extends Error {
  constructor(
    public readonly code:
      | 'ENCRYPTION_KEY_MISSING'
      | 'ENCRYPTION_KEY_INVALID'
      | 'CRYPTO_DECRYPT_FAILED',
    message: string
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isEncryptionConfigured(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}

/**
 * Startup check (F-108). Throws when the key is malformed in any environment,
 * and when it is missing in production.
 */
export function validateEncryptionKey(): void {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (isProduction()) {
      throw new CryptoError(
        'ENCRYPTION_KEY_MISSING',
        'ENCRYPTION_KEY is required in production (32 bytes as 64 hex characters).'
      );
    }
    return;
  }
  if (!KEY_HEX_RE.test(key)) {
    throw new CryptoError(
      'ENCRYPTION_KEY_INVALID',
      `ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters (got ${key.length} chars). ` +
        'Generate one with: openssl rand -hex 32'
    );
  }
}

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new CryptoError('ENCRYPTION_KEY_MISSING', 'ENCRYPTION_KEY is not set');
  }
  if (!KEY_HEX_RE.test(key)) {
    throw new CryptoError(
      'ENCRYPTION_KEY_INVALID',
      'ENCRYPTION_KEY must be exactly 32 bytes encoded as 64 hex characters'
    );
  }
  return Buffer.from(key, 'hex');
}

/**
 * Identifier of the key currently used for new ciphertexts. Stored on
 * `memory_entries.encryption_key_id` so a future rotation can tell which key
 * each row was written with. Override with ENCRYPTION_KEY_ID; defaults to a
 * truncated fingerprint of the key itself.
 */
export function getEncryptionKeyId(): string | null {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  if (process.env.ENCRYPTION_KEY_ID) return process.env.ENCRYPTION_KEY_ID;
  return `sha256:${crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
}

export function encrypt(plaintext: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    if (isProduction()) {
      throw new CryptoError(
        'ENCRYPTION_KEY_MISSING',
        'Refusing to store plaintext: ENCRYPTION_KEY is not set in production'
      );
    }
    return plaintext; // dev/test passthrough (non-production only)
  }
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * True when `value` has the exact shape encrypt() produces
 * (32-hex iv : 32-hex tag : hex ciphertext). Anything else is treated as
 * legacy plaintext by decrypt().
 */
export function looksEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, ct] = parts;
  return iv.length === 32 && tag.length === 32 && ct.length > 0 && ct.length % 2 === 0
    && HEX_RE.test(iv) && HEX_RE.test(tag) && HEX_RE.test(ct);
}

export function decrypt(encoded: string): string {
  if (!process.env.ENCRYPTION_KEY) {
    if (isProduction()) {
      throw new CryptoError(
        'ENCRYPTION_KEY_MISSING',
        'Cannot decrypt: ENCRYPTION_KEY is not set in production'
      );
    }
    return encoded; // dev/test passthrough (non-production only)
  }
  if (!looksEncrypted(encoded)) return encoded; // legacy plaintext (pre-encryption rows)
  const [ivHex, tagHex, ciphertextHex] = encoded.split(':');
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(ciphertextHex, 'hex', 'utf-8') + decipher.final('utf-8');
  } catch (err) {
    // F-109: never hand ciphertext back as plaintext. Log with a grep-able
    // code and throw so the caller fails loudly.
    logger.error('CRYPTO_DECRYPT_FAILED: ciphertext is corrupt, tampered, or encrypted with a different key', {
      code: 'CRYPTO_DECRYPT_FAILED',
      keyId: getEncryptionKeyId(),
      error: (err as Error).message,
    });
    throw new CryptoError(
      'CRYPTO_DECRYPT_FAILED',
      'Decryption failed: ciphertext is corrupt or was encrypted with a different key'
    );
  }
}
