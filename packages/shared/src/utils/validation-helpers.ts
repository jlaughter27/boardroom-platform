// Validation helper utilities
// Provides email validation, URL validation, phone number formatting, and other validation helpers

import { z } from 'zod';

/**
 * Check if a string is a valid email address.
 * @param email - Email address to validate
 * @returns True if email is valid
 * @example
 * ```ts
 * const isValid = isValidEmail('test@example.com'); // true
 * ```
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Check if a string is a valid URL.
 * @param url - URL to validate
 * @returns True if URL is valid
 * @example
 * ```ts
 * const isValid = isValidUrl('https://example.com'); // true
 * ```
 */
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if a string is a valid HTTP or HTTPS URL.
 * @param url - URL to validate
 * @returns True if URL is a valid HTTP/HTTPS URL
 * @example
 * ```ts
 * const isValid = isValidHttpUrl('https://example.com'); // true
 * ```
 */
export const isValidHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Format a phone number to E.164 format.
 * @param phoneNumber - Phone number to format
 * @param countryCode - Country code (default: '1' for US/Canada)
 * @returns Formatted phone number in E.164 format
 * @example
 * ```ts
 * const formatted = formatPhoneNumber('(123) 456-7890'); // '+11234567890'
 * ```
 */
export const formatPhoneNumber = (
  phoneNumber: string,
  countryCode: string = '1'
): string => {
  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  
  // Check if number already has country code
  // We need to check if the digits start with countryCode and the remaining digits
  // are at least 10 (North American standard) or reasonable length
  if (digits.startsWith(countryCode) && digits.length >= 11) {
    return `+${digits}`;
  }
  
  // Otherwise, prepend country code
  return `+${countryCode}${digits}`;
};

/**
 * Check if a string is a valid phone number (North American format).
 * @param phoneNumber - Phone number to validate
 * @returns True if phone number appears valid
 * @example
 * ```ts
 * const isValid = isValidPhoneNumber('(123) 456-7890'); // true
 * ```
 */
export const isValidPhoneNumber = (phoneNumber: string): boolean => {
  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  
  // North American phone numbers are 10 digits
  // International numbers vary, so we just check for reasonable length
  return digits.length >= 10 && digits.length <= 15;
};

/**
 * Validate a password meets security requirements.
 * @param password - Password to validate
 * @param options - Validation options
 * @returns Object with validation result and errors
 * @example
 * ```ts
 * const result = validatePassword('Password123!', { minLength: 8 });
 * ```
 */
export const validatePassword = (
  password: string,
  options: {
    minLength?: number;
    requireUppercase?: boolean;
    requireLowercase?: boolean;
    requireNumbers?: boolean;
    requireSpecialChars?: boolean;
  } = {}
): { isValid: boolean; errors: string[] } => {
  const {
    minLength = 8,
    requireUppercase = true,
    requireLowercase = true,
    requireNumbers = true,
    requireSpecialChars = true,
  } = options;
  
  const errors: string[] = [];
  
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }
  
  if (requireUppercase && !/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (requireLowercase && !/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (requireNumbers && !/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
  };
};

/**
 * Check if a string is a valid date string (YYYY-MM-DD format).
 * @param dateString - Date string to validate
 * @returns True if string is a valid date in YYYY-MM-DD format
 * @example
 * ```ts
 * const isValid = isValidDate('2024-12-31'); // true
 * ```
 */
export const isValidDate = (dateString: string): boolean => {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === dateString;
};

/**
 * Check if a string is a valid time string (HH:MM:SS format).
 * @param timeString - Time string to validate
 * @returns True if string is a valid time in HH:MM:SS format
 * @example
 * ```ts
 * const isValid = isValidTime('14:30:45'); // true
 * ```
 */
export const isValidTime = (timeString: string): boolean => {
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
  return timeRegex.test(timeString);
};

/**
 * Check if a string is a valid datetime string (ISO 8601 format).
 * @param datetimeString - Datetime string to validate
 * @returns True if string is a valid ISO 8601 datetime
 * @example
 * ```ts
 * const isValid = isValidDatetime('2024-12-31T14:30:45.000Z'); // true
 * ```
 */
export const isValidDatetime = (datetimeString: string): boolean => {
  const date = new Date(datetimeString);
  return !isNaN(date.getTime());
};

/**
 * Check if a string is a valid IP address (IPv4 or IPv6).
 * @param ip - IP address to validate
 * @returns True if string is a valid IP address
 * @example
 * ```ts
 * const isValid = isValidIpAddress('192.168.1.1'); // true
 * ```
 */
export const isValidIpAddress = (ip: string): boolean => {
  // IPv4 regex
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  
  // IPv6 regex (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

/**
 * Check if a string is a valid domain name.
 * @param domain - Domain name to validate
 * @returns True if string is a valid domain name
 * @example
 * ```ts
 * const isValid = isValidDomain('example.com'); // true
 * ```
 */
export const isValidDomain = (domain: string): boolean => {
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/i;
  return domainRegex.test(domain);
};

/**
 * Check if a string is a valid credit card number (Luhn algorithm).
 * @param cardNumber - Credit card number to validate
 * @returns True if card number passes Luhn check
 * @example
 * ```ts
 * const isValid = isValidCreditCard('4111111111111111'); // true (test card)
 * ```
 */
export const isValidCreditCard = (cardNumber: string): boolean => {
  // Remove all non-digit characters
  const digits = cardNumber.replace(/\D/g, '');
  
  // Check if length is reasonable for credit cards
  if (digits.length < 13 || digits.length > 19) {
    return false;
  }
  
  // Luhn algorithm
  let sum = 0;
  let isEven = false;
  
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits.charAt(i), 10);
    
    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
};

/**
 * Check if a string is a valid JSON string.
 * @param jsonString - JSON string to validate
 * @returns True if string is valid JSON
 * @example
 * ```ts
 * const isValid = isValidJson('{"key": "value"}'); // true
 * ```
 */
export const isValidJson = (jsonString: string): boolean => {
  try {
    JSON.parse(jsonString);
    return true;
  } catch {
    return false;
  }
};

/**
 * Create a Zod schema for email validation.
 * @param options - Validation options
 * @returns Zod schema for email validation
 * @example
 * ```ts
 * const emailSchema = createEmailSchema();
 * const result = emailSchema.parse('test@example.com');
 * ```
 */
export const createEmailSchema = (options: {
  required?: boolean;
  message?: string;
} = {}): z.ZodTypeAny => {
  const { required = true, message = 'Invalid email address' } = options;

  const base = z.string().trim().email({ message });

  if (required) {
    return base.min(1, 'Email is required');
  }
  return base.optional();
};

/**
 * Create a Zod schema for URL validation.
 * @param options - Validation options
 * @returns Zod schema for URL validation
 * @example
 * ```ts
 * const urlSchema = createUrlSchema();
 * const result = urlSchema.parse('https://example.com');
 * ```
 */
export const createUrlSchema = (options: {
  required?: boolean;
  message?: string;
} = {}): z.ZodTypeAny => {
  const { required = true, message = 'Invalid URL' } = options;

  const base = z.string().trim().url({ message });

  if (required) {
    return base.min(1, 'URL is required');
  }
  return base.optional();
};

/**
 * Create a Zod schema for phone number validation.
 * @param options - Validation options
 * @returns Zod schema for phone number validation
 * @example
 * ```ts
 * const phoneSchema = createPhoneSchema();
 * const result = phoneSchema.parse('(123) 456-7890');
 * ```
 */
export const createPhoneSchema = (options: {
  required?: boolean;
  message?: string;
} = {}): z.ZodTypeAny => {
  const { required = true, message = 'Invalid phone number' } = options;

  if (required) {
    return z
      .string()
      .trim()
      .min(1, 'Phone number is required')
      .refine(isValidPhoneNumber, { message });
  }
  return z
    .string()
    .trim()
    .refine(isValidPhoneNumber, { message })
    .optional();
};