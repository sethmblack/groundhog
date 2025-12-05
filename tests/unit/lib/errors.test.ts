import { describe, it, expect } from 'vitest';
import {
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  InternalError,
  ServiceUnavailableError,
  ExternalServiceError,
  isAppError,
} from '@/lib/errors';

describe('Error Classes', () => {
  describe('BadRequestError', () => {
    it('should have correct status code and code', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('BAD_REQUEST');
      expect(error.message).toBe('Invalid input');
      expect(error.isOperational).toBe(true);
    });

    it('should have default message', () => {
      const error = new BadRequestError();
      expect(error.message).toBe('Bad request');
    });

    it('should serialize to JSON correctly', () => {
      const error = new BadRequestError('Invalid input');
      expect(error.toJSON()).toEqual({
        error: 'BAD_REQUEST',
        message: 'Invalid input',
      });
    });
  });

  describe('ValidationError', () => {
    it('should include validation details', () => {
      const details = { email: ['Invalid email format'] };
      const error = new ValidationError('Validation failed', details);
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual(details);
    });

    it('should serialize with details', () => {
      const details = { email: ['Required'] };
      const error = new ValidationError('Validation failed', details);
      expect(error.toJSON()).toEqual({
        error: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { email: ['Required'] },
      });
    });
  });

  describe('UnauthorizedError', () => {
    it('should have correct status code', () => {
      const error = new UnauthorizedError();
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('UNAUTHORIZED');
      expect(error.message).toBe('Authentication required');
    });
  });

  describe('ForbiddenError', () => {
    it('should have correct status code', () => {
      const error = new ForbiddenError();
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('FORBIDDEN');
      expect(error.message).toBe('Access denied');
    });
  });

  describe('NotFoundError', () => {
    it('should have correct status code', () => {
      const error = new NotFoundError('Dashboard not found');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.message).toBe('Dashboard not found');
    });
  });

  describe('ConflictError', () => {
    it('should have correct status code', () => {
      const error = new ConflictError('Resource already exists');
      expect(error.statusCode).toBe(409);
      expect(error.code).toBe('CONFLICT');
    });
  });

  describe('RateLimitError', () => {
    it('should include retry-after', () => {
      const error = new RateLimitError('Too many requests', 120);
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(error.retryAfter).toBe(120);
    });

    it('should serialize with retryAfter', () => {
      const error = new RateLimitError('Slow down', 60);
      expect(error.toJSON()).toEqual({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Slow down',
        retryAfter: 60,
      });
    });
  });

  describe('InternalError', () => {
    it('should not be operational', () => {
      const error = new InternalError('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe('INTERNAL_ERROR');
      expect(error.isOperational).toBe(false);
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have correct status code', () => {
      const error = new ServiceUnavailableError('Service down', 300);
      expect(error.statusCode).toBe(503);
      expect(error.retryAfter).toBe(300);
    });
  });

  describe('ExternalServiceError', () => {
    it('should include service name', () => {
      const error = new ExternalServiceError('NewRelic', 'API returned 500');
      expect(error.statusCode).toBe(502);
      expect(error.service).toBe('NewRelic');
      expect(error.toJSON()).toEqual({
        error: 'EXTERNAL_SERVICE_ERROR',
        message: 'API returned 500',
        service: 'NewRelic',
      });
    });
  });

  describe('isAppError', () => {
    it('should return true for AppError instances', () => {
      expect(isAppError(new BadRequestError())).toBe(true);
      expect(isAppError(new NotFoundError())).toBe(true);
      expect(isAppError(new InternalError())).toBe(true);
    });

    it('should return false for non-AppError', () => {
      expect(isAppError(new Error('Regular error'))).toBe(false);
      expect(isAppError('string error')).toBe(false);
      expect(isAppError(null)).toBe(false);
      expect(isAppError(undefined)).toBe(false);
    });
  });
});
