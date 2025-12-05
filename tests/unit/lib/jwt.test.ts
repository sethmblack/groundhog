import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractBearerToken } from '@/lib/jwt';
import { UnauthorizedError } from '@/lib/errors';

describe('JWT Utils', () => {
  describe('extractBearerToken', () => {
    it('should extract token from valid Bearer header', () => {
      const token = extractBearerToken('Bearer abc123');
      expect(token).toBe('abc123');
    });

    it('should be case-insensitive for Bearer prefix', () => {
      const token = extractBearerToken('bearer abc123');
      expect(token).toBe('abc123');
    });

    it('should throw UnauthorizedError for missing header', () => {
      expect(() => extractBearerToken(undefined)).toThrow(UnauthorizedError);
      expect(() => extractBearerToken(undefined)).toThrow('Authorization header required');
    });

    it('should throw UnauthorizedError for empty header', () => {
      expect(() => extractBearerToken('')).toThrow(UnauthorizedError);
    });

    it('should throw UnauthorizedError for non-Bearer scheme', () => {
      expect(() => extractBearerToken('Basic abc123')).toThrow(UnauthorizedError);
      expect(() => extractBearerToken('Basic abc123')).toThrow(
        'Invalid authorization header format'
      );
    });

    it('should throw UnauthorizedError for malformed header', () => {
      expect(() => extractBearerToken('Bearer')).toThrow(UnauthorizedError);
      expect(() => extractBearerToken('Bearer token extra')).toThrow(UnauthorizedError);
    });
  });
});
