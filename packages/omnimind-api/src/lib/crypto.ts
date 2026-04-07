import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    // In dev mode without encryption key, pass through unencrypted
    return Buffer.alloc(32, 0);
  }
  return Buffer.from(key, 'hex');
}

export function encrypt(plaintext: string): string {
  if (!process.env.ENCRYPTION_KEY) return plaintext; // dev mode passthrough
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(encoded: string): string {
  if (!process.env.ENCRYPTION_KEY) return encoded; // dev mode passthrough
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
