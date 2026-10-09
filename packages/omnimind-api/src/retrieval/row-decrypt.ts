import { tryDecryptMemory } from '../lib/memory-crypto';

/**
 * O-111 — retrieval layers select `domain` + `encrypted_content` alongside
 * `content` and run every row through decryptMemory before it reaches the
 * ranker / context packager. A row that cannot be decrypted is logged (by
 * memory-crypto) and dropped rather than surfacing ciphertext or a placeholder.
 */
export interface EncryptedRowFields {
  id: string;
  domain?: string | null;
  content: string;
  encrypted_content?: Uint8Array | Buffer | null;
}

export function decryptRowContent<T extends EncryptedRowFields>(row: T): T | null {
  const dec = tryDecryptMemory({
    id: row.id,
    domain: row.domain ?? '',
    content: row.content,
    encryptedContent: row.encrypted_content ?? null,
  });
  if (!dec) return null;
  return dec.content === row.content ? row : { ...row, content: dec.content };
}

export function decryptRows<T extends EncryptedRowFields>(rows: T[]): T[] {
  const out: T[] = [];
  for (const r of rows) {
    const d = decryptRowContent(r);
    if (d) out.push(d);
  }
  return out;
}
