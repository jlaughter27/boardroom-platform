// Cryptographic hashing utilities
// Provides SHA-256, bcrypt for passwords, and deterministic hashing for caching

import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

/**
 * Generate SHA-256 hash of content for general purpose hashing.
 * @param content - The text content to hash
 * @returns Hex-encoded SHA-256 hash string (64 characters)
 * @example
 * ```ts
 * const hash = sha256('hello world');
 * // returns 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
 * ```
 */
export const sha256 = (content: string): string => {
  return createHash('sha256').update(content).digest('hex');
};

/**
 * Generate a deterministic hash for caching purposes.
 * Creates a consistent hash from any input for use as cache keys.
 * @param input - Any input that can be stringified
 * @returns Hex-encoded SHA-256 hash string
 * @example
 * ```ts
 * const cacheKey = deterministicHash({ userId: 123, type: 'profile' });
 * ```
 */
export const deterministicHash = (input: unknown): string => {
  const serialized = typeof input === 'string' 
    ? input 
    : JSON.stringify(input);
  return sha256(serialized);
};

/**
 * Hash a password using bcrypt with configurable salt rounds.
 * @param password - Plain text password to hash
 * @param saltRounds - Number of salt rounds (default: 10)
 * @returns Promise resolving to the hashed password
 * @example
 * ```ts
 * const hashed = await hashPassword('myPassword123');
 * ```
 */
export const hashPassword = async (
  password: string, 
  saltRounds: number = 10
): Promise<string> => {
  return bcrypt.hash(password, saltRounds);
};

/**
 * Verify a password against a bcrypt hash.
 * @param password - Plain text password to verify
 * @param hash - Bcrypt hash to compare against
 * @returns Promise resolving to true if password matches hash
 * @example
 * ```ts
 * const isValid = await verifyPassword('myPassword123', storedHash);
 * ```
 */
export const verifyPassword = async (
  password: string, 
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate a random token/secret of specified length.
 * @param length - Length of token in bytes (default: 32)
 * @returns Hex-encoded random token
 * @example
 * ```ts
 * const token = generateRandomToken(16); // 32 hex characters
 * ```
 */
export const generateRandomToken = (length: number = 32): string => {
  return randomBytes(length).toString('hex');
};

/**
 * Generate a SHA-256 HMAC (Hash-based Message Authentication Code).
 * @param data - The data to authenticate
 * @param secret - The secret key for HMAC
 * @returns Hex-encoded HMAC string
 * @example
 * ```ts
 * const hmac = generateHmac('sensitive data', 'secret-key');
 * ```
 */
export const generateHmac = (data: string, secret: string): string => {
  return createHash('sha256')
    .update(secret + data)
    .digest('hex');
};

/**
 * Verify data against an HMAC.
 * @param data - The data to verify
 * @param secret - The secret key for HMAC
 * @param expectedHmac - The expected HMAC to compare against
 * @returns True if HMAC matches
 * @example
 * ```ts
 * const isValid = verifyHmac('sensitive data', 'secret-key', expectedHmac);
 * ```
 */
export const verifyHmac = (
  data: string, 
  secret: string, 
  expectedHmac: string
): boolean => {
  const actualHmac = generateHmac(data, secret);
  return actualHmac === expectedHmac;
};