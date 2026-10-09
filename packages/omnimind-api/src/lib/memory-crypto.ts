import { CryptoError, decrypt, encrypt, getEncryptionKeyId, isEncryptionConfigured } from './crypto';
import { logger } from './logger';

/**
 * O-111 — encryption-at-rest for ministry-domain memory content.
 *
 * Write path:  encryptMemoryContent() returns the column values to persist
 *              (placeholder in `content`, ciphertext in `encrypted_content`,
 *              key id + algorithm) or null when the row is not ministry /
 *              encryption is not configured in a non-production environment.
 * Read path:   decryptMemory() swaps the placeholder for the decrypted text.
 *              It THROWS on failure (F-109) and never returns ciphertext.
 *              tryDecryptMemory() is the retrieval-layer variant: it logs and
 *              returns null so one corrupt row drops out instead of blanking a
 *              whole retrieval layer.
 */

export const ENCRYPTED_CONTENT_PLACEHOLDER = '[encrypted]';
export const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/** Canonical domain form — mirrors the Zod transform in @boardroom/shared. */
export function normalizeDomain(d: string | null | undefined): string {
  return (d ?? '').trim().toLowerCase();
}

export interface EncryptedWrite {
  content: string;
  /** Prisma `Bytes` — a fresh Uint8Array over its own ArrayBuffer. */
  encryptedContent: Uint8Array<ArrayBuffer>;
  encryptionKeyId: string | null;
  encryptionAlgorithm: string;
}


export function encryptMemoryContent(domain: string, content: string): EncryptedWrite | null {
  if (normalizeDomain(domain) !== 'ministry') return null;
  if (!isEncryptionConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      // F-108: no plaintext ministry rows in production, ever.
      throw new CryptoError(
        'ENCRYPTION_KEY_MISSING',
        'Refusing to store ministry content: ENCRYPTION_KEY is not set in production'
      );
    }
    return null; // dev/test without a key: stored as plaintext, same as before
  }
  const encoded = encrypt(content);
  return {
    content: ENCRYPTED_CONTENT_PLACEHOLDER,
    encryptedContent: new Uint8Array(Buffer.from(encoded, 'utf-8')),

    encryptionKeyId: getEncryptionKeyId(),
    encryptionAlgorithm: ENCRYPTION_ALGORITHM,
  };
}

export interface DecryptableMemory {
  id?: string;
  domain: string;
  content: string;
  encryptedContent?: Buffer | Uint8Array | null;
}

/**
 * Returns a copy with `content` decrypted when `encryptedContent` is present.
 * Throws CryptoError (F-109) when decryption is impossible or fails.
 */
export function decryptMemory<T extends DecryptableMemory>(mem: T): T {
  if (!mem.encryptedContent || mem.encryptedContent.length === 0) return mem;
  if (!isEncryptionConfigured()) {
    const err = new CryptoError(
      'ENCRYPTION_KEY_MISSING',
      'Memory has encrypted content but ENCRYPTION_KEY is not set'
    );
    logger.error('memory decrypt failed', { memoryId: mem.id, code: err.code });
    throw err;
  }
  const encoded = Buffer.from(mem.encryptedContent).toString('utf-8');
  try {
    return { ...mem, content: decrypt(encoded) };
  } catch (err) {
    const code = err instanceof CryptoError ? err.code : 'CRYPTO_DECRYPT_FAILED';
    logger.error('memory decrypt failed', { memoryId: mem.id, code });
    throw err instanceof CryptoError
      ? err
      : new CryptoError('CRYPTO_DECRYPT_FAILED', (err as Error).message);
  }
}

/** Retrieval-layer variant: null (already logged) instead of throwing. */
export function tryDecryptMemory<T extends DecryptableMemory>(mem: T): T | null {
  try {
    return decryptMemory(mem);
  } catch {
    return null;
  }
}
