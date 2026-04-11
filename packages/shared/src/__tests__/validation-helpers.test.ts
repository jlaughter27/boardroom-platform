import { describe, it, expect } from 'vitest';
import {
  isValidEmail,
  isValidUrl,
  isValidHttpUrl,
  formatPhoneNumber,
  isValidPhoneNumber,
  validatePassword,
  isValidDate,
  isValidTime,
  isValidDatetime,
  isValidIpAddress,
  isValidDomain,
  isValidCreditCard,
  isValidJson
} from '../utils/validation-helpers';

describe('validation helpers', () => {
  describe('isValidEmail', () => {
    it('validates email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('invalid')).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    it('validates URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('invalid')).toBe(false);
    });
  });

  describe('isValidHttpUrl', () => {
    it('validates HTTP/HTTPS URLs', () => {
      expect(isValidHttpUrl('https://example.com')).toBe(true);
      expect(isValidHttpUrl('ftp://example.com')).toBe(false);
    });
  });

  describe('formatPhoneNumber', () => {
    it('formats phone number to E.164 format', () => {
      // Default country code is '1', so '(123) 456-7890' -> '+11234567890'
      expect(formatPhoneNumber('(123) 456-7890')).toBe('+11234567890');
      // With explicit country code
      expect(formatPhoneNumber('(123) 456-7890', '44')).toBe('+441234567890');
    });
  });

  describe('isValidPhoneNumber', () => {
    it('validates phone numbers', () => {
      expect(isValidPhoneNumber('(123) 456-7890')).toBe(true);
      expect(isValidPhoneNumber('123')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    it('validates password strength', () => {
      const strongPass = validatePassword('Password123!');
      expect(strongPass.isValid).toBe(true);
    });
  });

  describe('isValidDate', () => {
    it('validates date strings', () => {
      expect(isValidDate('2024-12-31')).toBe(true);
      expect(isValidDate('invalid')).toBe(false);
    });
  });

  describe('isValidTime', () => {
    it('validates time strings', () => {
      expect(isValidTime('14:30:45')).toBe(true);
      expect(isValidTime('invalid')).toBe(false);
    });
  });

  describe('isValidDatetime', () => {
    it('validates datetime strings', () => {
      expect(isValidDatetime('2024-12-31T14:30:45.123Z')).toBe(true);
    });
  });

  describe('isValidIpAddress', () => {
    it('validates IP addresses', () => {
      expect(isValidIpAddress('192.168.1.1')).toBe(true);
      expect(isValidIpAddress('invalid')).toBe(false);
    });
  });

  describe('isValidDomain', () => {
    it('validates domain names', () => {
      expect(isValidDomain('example.com')).toBe(true);
    });
  });

  describe('isValidCreditCard', () => {
    it('validates credit card numbers', () => {
      expect(isValidCreditCard('4111111111111111')).toBe(true);
    });
  });

  describe('isValidJson', () => {
    it('validates JSON strings', () => {
      expect(isValidJson('{"key": "value"}')).toBe(true);
      expect(isValidJson('invalid')).toBe(false);
    });
  });
});