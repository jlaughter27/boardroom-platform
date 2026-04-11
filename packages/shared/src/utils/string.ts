// String manipulation utilities
// Provides slug generation, truncation, case conversion, and other string helpers

/**
 * Convert a string to a URL-friendly slug.
 * @param text - Text to convert to slug
 * @param separator - Word separator (default: '-')
 * @returns URL-friendly slug
 * @example
 * ```ts
 * const slug = generateSlug('Hello World!'); // 'hello-world'
 * ```
 */
export const generateSlug = (text: string, separator: string = '-'): string => {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/\s+/g, separator) // Replace spaces with separator
    .replace(new RegExp(`${separator}+`, 'g'), separator) // Remove duplicate separators
    .trim();
};

/**
 * Truncate a string to a specified length with an ellipsis.
 * @param text - Text to truncate
 * @param maxLength - Maximum length (including ellipsis if added)
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated string
 * @example
 * ```ts
 * const truncated = truncate('Hello world', 8); // 'Hello...'
 * ```
 */
export const truncate = (
  text: string, 
  maxLength: number, 
  ellipsis: string = '...'
): string => {
  if (text.length <= maxLength) {
    return text;
  }
  
  const truncateLength = maxLength - ellipsis.length;
  if (truncateLength <= 0) {
    return ellipsis.slice(0, maxLength);
  }
  
  return text.slice(0, truncateLength) + ellipsis;
};

/**
 * Convert string to camelCase.
 * @param text - Text to convert
 * @returns camelCase string
 * @example
 * ```ts
 * const camel = toCamelCase('hello_world'); // 'helloWorld'
 * ```
 */
export const toCamelCase = (text: string): string => {
  return text
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
};

/**
 * Convert string to PascalCase.
 * @param text - Text to convert
 * @returns PascalCase string
 * @example
 * ```ts
 * const pascal = toPascalCase('hello_world'); // 'HelloWorld'
 * ```
 */
export const toPascalCase = (text: string): string => {
  return text
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char) => char.toUpperCase())
    .replace(/^[a-z]/, (char) => char.toUpperCase());
};

/**
 * Convert string to kebab-case.
 * @param text - Text to convert
 * @returns kebab-case string
 * @example
 * ```ts
 * const kebab = toKebabCase('helloWorld'); // 'hello-world'
 * ```
 */
export const toKebabCase = (text: string): string => {
  return text
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
};

/**
 * Convert string to snake_case.
 * @param text - Text to convert
 * @returns snake_case string
 * @example
 * ```ts
 * const snake = toSnakeCase('helloWorld'); // 'hello_world'
 * ```
 */
export const toSnakeCase = (text: string): string => {
  return text
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
};

/**
 * Capitalize the first letter of a string.
 * @param text - Text to capitalize
 * @returns Capitalized string
 * @example
 * ```ts
 * const capitalized = capitalize('hello'); // 'Hello'
 * ```
 */
export const capitalize = (text: string): string => {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * Capitalize the first letter of each word in a string.
 * @param text - Text to capitalize
 * @returns Title cased string
 * @example
 * ```ts
 * const title = titleCase('hello world'); // 'Hello World'
 * ```
 */
export const titleCase = (text: string): string => {
  return text
    .split(' ')
    .map(word => capitalize(word))
    .join(' ');
};

/**
 * Remove all whitespace from a string.
 * @param text - Text to process
 * @returns String without whitespace
 * @example
 * ```ts
 * const noSpaces = removeWhitespace('hello world'); // 'helloworld'
 * ```
 */
export const removeWhitespace = (text: string): string => {
  return text.replace(/\s+/g, '');
};

/**
 * Normalize whitespace (replace multiple spaces with single space).
 * @param text - Text to normalize
 * @returns String with normalized whitespace
 * @example
 * ```ts
 * const normalized = normalizeWhitespace('hello   world'); // 'hello world'
 * ```
 */
export const normalizeWhitespace = (text: string): string => {
  return text.replace(/\s+/g, ' ').trim();
};

/**
 * Check if a string contains only alphabetic characters.
 * @param text - Text to check
 * @returns True if string contains only letters
 * @example
 * ```ts
 * const isAlpha = isAlpha('Hello'); // true
 * ```
 */
export const isAlpha = (text: string): boolean => {
  return /^[A-Za-z]+$/.test(text);
};

/**
 * Check if a string contains only alphanumeric characters.
 * @param text - Text to check
 * @returns True if string contains only letters and numbers
 * @example
 * ```ts
 * const isAlphaNumeric = isAlphaNumeric('Hello123'); // true
 * ```
 */
export const isAlphaNumeric = (text: string): boolean => {
  return /^[A-Za-z0-9]+$/.test(text);
};

/**
 * Check if a string contains only numeric characters.
 * @param text - Text to check
 * @returns True if string contains only numbers
 * @example
 * ```ts
 * const isNumeric = isNumeric('123'); // true
 * ```
 */
export const isNumeric = (text: string): boolean => {
  return /^[0-9]+$/.test(text);
};

/**
 * Generate a random string of specified length.
 * @param length - Length of random string (default: 10)
 * @param charset - Character set to use (default: alphanumeric)
 * @returns Random string
 * @example
 * ```ts
 * const random = generateRandomString(8); // 'A1b2C3d4'
 * ```
 */
export const generateRandomString = (
  length: number = 10,
  charset: string = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
): string => {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return result;
};

/**
 * Mask sensitive information in a string (e.g., email, credit card).
 * @param text - Text to mask
 * @param visibleChars - Number of characters to keep visible at start and end
 * @param maskChar - Character to use for masking (default: '*')
 * @returns Masked string
 * @example
 * ```ts
 * const masked = maskString('test@example.com', 3); // 'tes*****@example.com'
 * ```
 */
export const maskString = (
  text: string,
  visibleChars: number = 4,
  maskChar: string = '*'
): string => {
  if (text.length <= visibleChars * 2) {
    return text;
  }
  
  const start = text.slice(0, visibleChars);
  const end = text.slice(-visibleChars);
  const middle = maskChar.repeat(text.length - (visibleChars * 2));
  
  return start + middle + end;
};

/**
 * Check if a string is a valid UUID.
 * @param text - Text to check
 * @returns True if string is a valid UUID
 * @example
 * ```ts
 * const isValid = isValidUuid('123e4567-e89b-12d3-a456-426614174000'); // true
 * ```
 */
export const isValidUuid = (text: string): boolean => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(text);
};

/**
 * Count the number of words in a string.
 * @param text - Text to count words in
 * @returns Number of words
 * @example
 * ```ts
 * const wordCount = countWords('Hello world!'); // 2
 * ```
 */
export const countWords = (text: string): number => {
  return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};