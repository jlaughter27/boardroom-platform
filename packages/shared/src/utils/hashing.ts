// Hashing utilities for memory deduplication
// Used by OmniMind memory pipeline to detect duplicate content

import { createHash } from 'crypto';

/**
 * Generate SHA-256 hash of content for memory deduplication.
 * @param content - The text content to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export const sha256Hash = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
};
