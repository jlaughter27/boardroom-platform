// Number manipulation utilities
// Provides formatting, rounding, percentage calculation, and other number helpers

/**
 * Format a number with thousands separators.
 * @param num - Number to format
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted number string
 * @example
 * ```ts
 * const formatted = formatNumber(1234567); // '1,234,567'
 * ```
 */
export const formatNumber = (num: number, locale: string = 'en-US'): string => {
  return new Intl.NumberFormat(locale).format(num);
};

/**
 * Format a number as currency.
 * @param num - Number to format
 * @param currency - Currency code (default: 'USD')
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted currency string
 * @example
 * ```ts
 * const formatted = formatCurrency(1234.56); // '$1,234.56'
 * ```
 */
export const formatCurrency = (
  num: number,
  currency: string = 'USD',
  locale: string = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(num);
};

/**
 * Format a number as a percentage.
 * @param num - Number to format (as decimal, e.g., 0.15 for 15%)
 * @param decimals - Number of decimal places (default: 2)
 * @param locale - Locale for formatting (default: 'en-US')
 * @returns Formatted percentage string
 * @example
 * ```ts
 * const formatted = formatPercent(0.1567); // '15.67%'
 * ```
 */
export const formatPercent = (
  num: number,
  decimals: number = 2,
  locale: string = 'en-US'
): string => {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

/**
 * Round a number to specified decimal places.
 * @param num - Number to round
 * @param decimals - Number of decimal places (default: 2)
 * @returns Rounded number
 * @example
 * ```ts
 * const rounded = round(123.4567, 2); // 123.46
 * ```
 */
export const round = (num: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.round((num + Number.EPSILON) * factor) / factor;
};

/**
 * Round a number down to specified decimal places.
 * @param num - Number to round down
 * @param decimals - Number of decimal places (default: 2)
 * @returns Rounded down number
 * @example
 * ```ts
 * const floored = floor(123.4567, 2); // 123.45
 * ```
 */
export const floor = (num: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.floor(num * factor) / factor;
};

/**
 * Round a number up to specified decimal places.
 * @param num - Number to round up
 * @param decimals - Number of decimal places (default: 2)
 * @returns Rounded up number
 * @example
 * ```ts
 * const ceiled = ceil(123.4567, 2); // 123.46
 * ```
 */
export const ceil = (num: number, decimals: number = 2): number => {
  const factor = Math.pow(10, decimals);
  return Math.ceil(num * factor) / factor;
};

/**
 * Calculate percentage of a number.
 * @param value - The value to calculate percentage of
 * @param total - The total value
 * @returns Percentage as decimal (0-1)
 * @example
 * ```ts
 * const percentage = calculatePercent(25, 100); // 0.25
 * ```
 */
export const calculatePercent = (value: number, total: number): number => {
  if (total === 0) return 0;
  return value / total;
};

/**
 * Calculate percentage change between two values.
 * @param oldValue - The old value
 * @param newValue - The new value
 * @returns Percentage change (positive for increase, negative for decrease)
 * @example
 * ```ts
 * const change = calculatePercentChange(100, 125); // 0.25 (25% increase)
 * ```
 */
export const calculatePercentChange = (oldValue: number, newValue: number): number => {
  if (oldValue === 0) return newValue === 0 ? 0 : Infinity;
  return (newValue - oldValue) / oldValue;
};

/**
 * Calculate value from percentage.
 * @param percentage - Percentage as decimal (e.g., 0.25 for 25%)
 * @param total - The total value
 * @returns Value representing the percentage of total
 * @example
 * ```ts
 * const value = calculateValueFromPercent(0.25, 100); // 25
 * ```
 */
export const calculateValueFromPercent = (percentage: number, total: number): number => {
  return percentage * total;
};

/**
 * Calculate simple interest.
 * @param principal - Principal amount
 * @param rate - Annual interest rate as decimal (e.g., 0.05 for 5%)
 * @param time - Time in years
 * @returns Simple interest amount
 * @example
 * ```ts
 * const interest = calculateSimpleInterest(1000, 0.05, 2); // 100
 * ```
 */
export const calculateSimpleInterest = (
  principal: number,
  rate: number,
  time: number
): number => {
  return principal * rate * time;
};

/**
 * Calculate compound interest.
 * @param principal - Principal amount
 * @param rate - Annual interest rate as decimal (e.g., 0.05 for 5%)
 * @param time - Time in years
 * @param compoundsPerYear - Number of times interest compounds per year (default: 1)
 * @returns Compound interest amount
 * @example
 * ```ts
 * const interest = calculateCompoundInterest(1000, 0.05, 2); // 102.50
 * ```
 */
export const calculateCompoundInterest = (
  principal: number,
  rate: number,
  time: number,
  compoundsPerYear: number = 1
): number => {
  const amount = principal * Math.pow(1 + rate / compoundsPerYear, compoundsPerYear * time);
  return amount - principal;
};

/**
 * Calculate average of numbers.
 * @param numbers - Array of numbers
 * @returns Average value
 * @example
 * ```ts
 * const avg = calculateAverage([1, 2, 3, 4]); // 2.5
 * ```
 */
export const calculateAverage = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;
  const sum = numbers.reduce((acc, num) => acc + num, 0);
  return sum / numbers.length;
};

/**
 * Calculate median of numbers.
 * @param numbers - Array of numbers
 * @returns Median value
 * @example
 * ```ts
 * const median = calculateMedian([1, 3, 2]); // 2
 * ```
 */
export const calculateMedian = (numbers: number[]): number => {
  if (numbers.length === 0) return 0;
  
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
};

/**
 * Calculate sum of numbers.
 * @param numbers - Array of numbers
 * @returns Sum of numbers
 * @example
 * ```ts
 * const sum = calculateSum([1, 2, 3]); // 6
 * ```
 */
export const calculateSum = (numbers: number[]): number => {
  return numbers.reduce((acc, num) => acc + num, 0);
};

/**
 * Clamp a number between min and max values.
 * @param num - Number to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped number
 * @example
 * ```ts
 * const clamped = clamp(150, 0, 100); // 100
 * ```
 */
export const clamp = (num: number, min: number, max: number): number => {
  return Math.min(Math.max(num, min), max);
};

/**
 * Check if a number is within a range (inclusive).
 * @param num - Number to check
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns True if number is within range
 * @example
 * ```ts
 * const inRange = isInRange(50, 0, 100); // true
 * ```
 */
export const isInRange = (num: number, min: number, max: number): boolean => {
  return num >= min && num <= max;
};

/**
 * Generate a random number within a range.
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns Random number within range
 * @example
 * ```ts
 * const random = randomInRange(1, 10); // Random number between 1 and 10
 * ```
 */
export const randomInRange = (min: number, max: number): number => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Calculate factorial of a number.
 * @param n - Number to calculate factorial for
 * @returns Factorial value
 * @example
 * ```ts
 * const factorial = calculateFactorial(5); // 120
 * ```
 */
export const calculateFactorial = (n: number): number => {
  if (n < 0) return NaN;
  if (n === 0 || n === 1) return 1;
  
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
};

/**
 * Convert bytes to human-readable format (KB, MB, GB, etc.).
 * @param bytes - Number of bytes
 * @param decimals - Number of decimal places (default: 2)
 * @returns Human-readable string
 * @example
 * ```ts
 * const readable = formatBytes(1024); // '1 KB'
 * ```
 */
export const formatBytes = (bytes: number, decimals: number = 2): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
};