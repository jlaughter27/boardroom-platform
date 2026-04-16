// Token generation and validation utilities
// Provides JWT handling, short code generation, and API token utilities

import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';

/**
 * Interface for JWT payload structure
 */
export interface JwtPayload {
  userId: string;
  email?: string;
  roles?: string[];
  [key: string]: unknown;
}

/**
 * Generate a JSON Web Token (JWT) with a payload and expiration.
 * @param payload - The payload to encode in the token
 * @param secret - The secret key for signing the token
 * @param expiresIn - Token expiration time (e.g., '1h', '7d', '30d')
 * @returns Signed JWT string
 * @example
 * ```ts
 * const token = generateJwt({ userId: '123' }, 'secret-key', '7d');
 * ```
 */
export const generateJwt = (
  payload: JwtPayload,
  secret: string,
  expiresIn: string
): string => {
  return jwt.sign(payload as jwt.JwtPayload, secret, { expiresIn } as jwt.SignOptions);
};

/**
 * Verify and decode a JSON Web Token (JWT).
 * @param token - The JWT token to verify
 * @param secret - The secret key used to sign the token
 * @returns Decoded payload if token is valid
 * @throws Error if token is invalid or expired
 * @example
 * ```ts
 * const payload = verifyJwt(token, 'secret-key');
 * ```
 */
export const verifyJwt = <T extends JwtPayload = JwtPayload>(
  token: string,
  secret: string
): T => {
  return jwt.verify(token, secret) as T;
};

/**
 * Decode a JWT without verification (useful for debugging).
 * @param token - The JWT token to decode
 * @returns Decoded payload (not verified)
 * @example
 * ```ts
 * const payload = decodeJwt(token);
 * ```
 */
export const decodeJwt = <T extends JwtPayload = JwtPayload>(
  token: string
): T | null => {
  try {
    return jwt.decode(token) as T;
  } catch {
    return null;
  }
};

/**
 * Generate a short alphanumeric code (6-8 characters).
 * @param length - Length of code (default: 6)
 * @returns Short alphanumeric code
 * @example
 * ```ts
 * const code = generateShortCode(); // 'A1B2C3'
 * ```
 */
export const generateShortCode = (length: number = 6): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  
  return result;
};

/**
 * Generate a secure API token (random bytes encoded in hex).
 * @param length - Length in bytes (default: 32 = 64 hex characters)
 * @returns Secure API token
 * @example
 * ```ts
 * const apiToken = generateApiToken(); // 'a1b2c3...'
 * ```
 */
export const generateApiToken = (length: number = 32): string => {
  return randomBytes(length).toString('hex');
};

/**
 * Generate a bearer token for API authentication.
 * @param userId - User ID to include in token
 * @param secret - Secret key for signing
 * @param expiresIn - Token expiration time (default: '30d')
 * @returns Bearer token string (prefixed with 'Bearer ')
 * @example
 * ```ts
 * const bearerToken = generateBearerToken('user123', 'secret', '7d');
 * // returns 'Bearer eyJhbGciOiJIUzI1NiIs...'
 * ```
 */
export const generateBearerToken = (
  userId: string,
  secret: string,
  expiresIn: string = '30d'
): string => {
  const token = generateJwt({ userId }, secret, expiresIn);
  return `Bearer ${token}`;
};

/**
 * Extract token from Authorization header.
 * @param authHeader - Authorization header value
 * @returns Token without 'Bearer ' prefix, or null if invalid
 * @example
 * ```ts
 * const token = extractTokenFromHeader('Bearer eyJhbGciOiJ...');
 * ```
 */
export const extractTokenFromHeader = (authHeader: string | undefined): string | null => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7); // Remove 'Bearer ' prefix
};

/**
 * Generate a refresh token (long-lived token for obtaining new access tokens).
 * @param userId - User ID to include in token
 * @param secret - Secret key for signing
 * @param expiresIn - Expiration time (default: '90d')
 * @returns Refresh token
 * @example
 * ```ts
 * const refreshToken = generateRefreshToken('user123', 'secret');
 * ```
 */
export const generateRefreshToken = (
  userId: string,
  secret: string,
  expiresIn: string = '90d'
): string => {
  return generateJwt({ userId, type: 'refresh' }, secret, expiresIn);
};

/**
 * Generate a password reset token (short-lived).
 * @param userId - User ID to include in token
 * @param secret - Secret key for signing
 * @param expiresIn - Expiration time (default: '1h')
 * @returns Password reset token
 * @example
 * ```ts
 * const resetToken = generatePasswordResetToken('user123', 'secret');
 * ```
 */
export const generatePasswordResetToken = (
  userId: string,
  secret: string,
  expiresIn: string = '1h'
): string => {
  return generateJwt({ userId, type: 'password_reset' }, secret, expiresIn);
};

/**
 * Generate an email verification token.
 * @param userId - User ID to include in token
 * @param email - Email address to verify
 * @param secret - Secret key for signing
 * @param expiresIn - Expiration time (default: '24h')
 * @returns Email verification token
 * @example
 * ```ts
 * const verifyToken = generateEmailVerificationToken('user123', 'test@example.com', 'secret');
 * ```
 */
export const generateEmailVerificationToken = (
  userId: string,
  email: string,
  secret: string,
  expiresIn: string = '24h'
): string => {
  return generateJwt({ userId, email, type: 'email_verification' }, secret, expiresIn);
};

/**
 * Check if a token is expired (without verifying signature).
 * @param token - JWT token to check
 * @returns True if token is expired, false otherwise
 * @example
 * ```ts
 * const isExpired = isTokenExpired(token);
 * ```
 */
export const isTokenExpired = (token: string): boolean => {
  const decoded = decodeJwt(token);
  if (!decoded || typeof decoded !== 'object' || !('exp' in decoded)) {
    return true;
  }
  
  const exp = decoded.exp as number;
  const now = Math.floor(Date.now() / 1000);
  return exp < now;
};

/**
 * Get time remaining until token expiration in seconds.
 * @param token - JWT token to check
 * @returns Seconds remaining until expiration, negative if expired
 * @example
 * ```ts
 * const secondsLeft = getTokenExpirationTime(token);
 * ```
 */
export const getTokenExpirationTime = (token: string): number => {
  const decoded = decodeJwt(token);
  if (!decoded || typeof decoded !== 'object' || !('exp' in decoded)) {
    return -1;
  }
  
  const exp = decoded.exp as number;
  const now = Math.floor(Date.now() / 1000);
  return exp - now;
};