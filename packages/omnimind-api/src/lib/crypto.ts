import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Phase 0.25.5 — ENCRYPTION_KEY fail-closed.
 *
 * The previous implementation silently passed plaintext through when
 * ENCRYPTION_KEY was unset. That was a foot-gun: a misconfigured
 * prod-like staging could store unencrypted OAuth tokens with no warning.
 *
 * New contract:
 *   - In any environment other than `test`, a missing ENCRYPTION_KEY
 *     causes the process to exit(1) within 100ms of module load.
 *   - For local dev without a real key, set `ALLOW_PLAINTEXT_DEV=true`
 *     explicitly. This logs a loud startup warning.
 *   - In tests, plaintext passthrough is allowed (NODE_ENV=test).
 *
 * This module is imported eagerly by the OmniMind server, so the guard
 * runs at process startup.
 */
const ALLOW_PLAINTEXT_DEV = process.env.ALLOW_PLAINTEXT_DEV === 'true';
const IS_TEST = process.env.NODE_ENV === 'test';
const PLAINTEXT_MODE = !process.env.ENCRYPTION_KEY && (IS_TEST || ALLOW_PLAINTEXT_DEV);

// One-shot startup check. Skipped only in test or with explicit dev opt-in.
if (!process.env.ENCRYPTION_KEY && !IS_TEST && !ALLOW_PLAINTEXT_DEV) {
  // eslint-disable-next-line no-console
  console.error(
    '[crypto] FATAL: ENCRYPTION_KEY is not set. Refusing to start.\n' +
      '         Set ENCRYPTION_KEY=<64-hex-char string> in your env, or\n' +
      '         set ALLOW_PLAINTEXT_DEV=true explicitly for local dev only.\n' +
      '         (Plaintext fallback in any non-test environment is a security bug.)',
  );
  // Exit synchronously — well within 100ms (no async work above).
  process.exit(1);
}

if (PLAINTEXT_MODE) {
  // eslint-disable-next-line no-console
  console.warn(
    '[crypto] WARNING: running with plaintext passthrough — no encryption. ' +
      'This is acceptable only in test or explicit dev mode. ' +
      `(NODE_ENV=${process.env.NODE_ENV ?? '<unset>'}, ALLOW_PLAINTEXT_DEV=${ALLOW_PLAINTEXT_DEV})`,
  );
}

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // Only reachable in PLAINTEXT_MODE — guarded above.
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): string {
  if (PLAINTEXT_MODE) return plaintext;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  if (PLAINTEXT_MODE) return encoded;
  if (!encoded.includes(':')) return encoded; // plaintext (pre-encryption migration)
  const [ivHex, tagHex, ciphertextHex] = encoded.split(':');
  if (!ivHex || !tagHex || !ciphertextHex) return encoded; // fallback
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(ciphertextHex, 'hex', 'utf-8') + decipher.final('utf-8');
  } catch {
    return encoded; // if decryption fails, return as-is (migration safety)
  }
}

// Test/inspection helper — exposes effective posture without leaking the key.
export function _cryptoStatus(): { plaintextMode: boolean; hasKey: boolean } {
  return { plaintextMode: PLAINTEXT_MODE, hasKey: !!process.env.ENCRYPTION_KEY };
}
