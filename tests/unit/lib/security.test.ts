import { describe, it, expect } from 'vitest';
import {
  validateRedirectUrl,
  sanitizeString,
  isValidUuid,
  validateUuid,
  isValidEmail,
  validateEmail,
  maskSensitiveData,
  validatePagination,
  validateContentType,
  isValidIpAddress,
  getClientIp,
  secureCompare,
} from '@/lib/security';
import { BadRequestError } from '@/lib/errors';

describe('Security Utilities', () => {
  describe('validateRedirectUrl', () => {
    it('should accept valid groundhog URLs', () => {
      expect(validateRedirectUrl('https://app.groundhog.io/dashboard')).toBe(true);
      expect(validateRedirectUrl('https://admin.groundhog.io/')).toBe(true);
    });

    it('should accept localhost URLs', () => {
      expect(validateRedirectUrl('http://localhost:3000/')).toBe(true);
      expect(validateRedirectUrl('https://localhost:8080/callback')).toBe(true);
    });

    it('should reject external URLs', () => {
      expect(validateRedirectUrl('https://evil.com/steal')).toBe(false);
      expect(validateRedirectUrl('https://groundhog.io.evil.com/')).toBe(false);
    });

    it('should reject non-http protocols', () => {
      expect(validateRedirectUrl('javascript:alert(1)')).toBe(false);
      expect(validateRedirectUrl('file:///etc/passwd')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(validateRedirectUrl('not-a-url')).toBe(false);
      expect(validateRedirectUrl('')).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    it('should remove null bytes', () => {
      expect(sanitizeString('hello\0world')).toBe('helloworld');
    });

    it('should truncate to max length', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeString(long, 50)).toBe('a'.repeat(50));
    });

    it('should return string unchanged if valid', () => {
      expect(sanitizeString('hello world')).toBe('hello world');
    });

    it('should throw on non-string input', () => {
      expect(() => sanitizeString(123 as unknown as string)).toThrow(BadRequestError);
    });
  });

  describe('isValidUuid', () => {
    it('should accept valid UUIDs', () => {
      expect(isValidUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUuid('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(isValidUuid('not-a-uuid')).toBe(false);
      expect(isValidUuid('550e8400-e29b-41d4-a716')).toBe(false);
      expect(isValidUuid('')).toBe(false);
    });
  });

  describe('validateUuid', () => {
    it('should not throw for valid UUID', () => {
      expect(() => validateUuid('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });

    it('should throw BadRequestError for invalid UUID', () => {
      expect(() => validateUuid('invalid')).toThrow(BadRequestError);
      expect(() => validateUuid('invalid', 'userId')).toThrow('Invalid userId format');
    });
  });

  describe('isValidEmail', () => {
    it('should accept valid emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name+tag@domain.co.uk')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('@nodomain.com')).toBe(false);
      expect(isValidEmail('noat.example.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    it('should reject overly long emails', () => {
      const longEmail = 'a'.repeat(250) + '@b.com';
      expect(isValidEmail(longEmail)).toBe(false);
    });
  });

  describe('validateEmail', () => {
    it('should not throw for valid email', () => {
      expect(() => validateEmail('test@example.com')).not.toThrow();
    });

    it('should throw BadRequestError for invalid email', () => {
      expect(() => validateEmail('invalid')).toThrow(BadRequestError);
    });
  });

  describe('maskSensitiveData', () => {
    it('should mask password fields', () => {
      const data = { username: 'john', password: 'secret123' };
      const masked = maskSensitiveData(data);
      expect(masked['username']).toBe('john');
      expect(masked['password']).toBe('***REDACTED***');
    });

    it('should mask nested sensitive fields', () => {
      const data = { user: { email: 'test@example.com', apiKey: 'key123' } };
      const masked = maskSensitiveData(data);
      expect((masked['user'] as Record<string, unknown>)['email']).toBe('test@example.com');
      expect((masked['user'] as Record<string, unknown>)['apiKey']).toBe('***REDACTED***');
    });

    it('should mask various sensitive field names', () => {
      const data = {
        token: 'abc',
        secret: 'xyz',
        authorization: 'Bearer token',
      };
      const masked = maskSensitiveData(data);
      expect(masked['token']).toBe('***REDACTED***');
      expect(masked['secret']).toBe('***REDACTED***');
      expect(masked['authorization']).toBe('***REDACTED***');
    });
  });

  describe('validatePagination', () => {
    it('should return default values when no params provided', () => {
      const result = validatePagination();
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should parse string parameters', () => {
      const result = validatePagination('50', '10');
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(10);
    });

    it('should enforce max limit', () => {
      const result = validatePagination(500, 0, 100);
      expect(result.limit).toBe(100);
    });

    it('should handle invalid values', () => {
      const result = validatePagination('invalid', 'bad');
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should handle negative values', () => {
      const result = validatePagination(-10, -5);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });
  });

  describe('validateContentType', () => {
    it('should accept valid content type', () => {
      expect(() =>
        validateContentType('application/json', ['application/json'])
      ).not.toThrow();
    });

    it('should handle content type with charset', () => {
      expect(() =>
        validateContentType('application/json; charset=utf-8', ['application/json'])
      ).not.toThrow();
    });

    it('should throw for missing content type', () => {
      expect(() =>
        validateContentType(undefined, ['application/json'])
      ).toThrow(BadRequestError);
    });

    it('should throw for invalid content type', () => {
      expect(() =>
        validateContentType('text/html', ['application/json'])
      ).toThrow(BadRequestError);
    });
  });

  describe('isValidIpAddress', () => {
    it('should accept valid IPv4 addresses', () => {
      expect(isValidIpAddress('192.168.1.1')).toBe(true);
      expect(isValidIpAddress('10.0.0.1')).toBe(true);
      expect(isValidIpAddress('127.0.0.1')).toBe(true);
    });

    it('should accept valid IPv6 addresses', () => {
      expect(isValidIpAddress('::1')).toBe(true);
      expect(isValidIpAddress('2001:db8::1')).toBe(true);
    });

    it('should reject invalid IP addresses', () => {
      expect(isValidIpAddress('999.999.999.999')).toBe(false);
      expect(isValidIpAddress('not-an-ip')).toBe(false);
      expect(isValidIpAddress('')).toBe(false);
    });
  });

  describe('getClientIp', () => {
    it('should extract first IP from X-Forwarded-For', () => {
      expect(getClientIp('192.168.1.1, 10.0.0.1', undefined)).toBe('192.168.1.1');
    });

    it('should fall back to remote address', () => {
      expect(getClientIp(undefined, '127.0.0.1')).toBe('127.0.0.1');
    });

    it('should return unknown when no IP available', () => {
      expect(getClientIp(undefined, undefined)).toBe('unknown');
    });
  });

  describe('secureCompare', () => {
    it('should return true for matching strings', () => {
      expect(secureCompare('password123', 'password123')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(secureCompare('password123', 'password456')).toBe(false);
    });

    it('should return false for different length strings', () => {
      expect(secureCompare('short', 'longer-string')).toBe(false);
    });
  });
});
