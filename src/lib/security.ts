import { BadRequestError } from './errors';

// URL validation for redirect URLs (prevent open redirect)
const ALLOWED_REDIRECT_PATTERNS = [
  /^https:\/\/[a-zA-Z0-9-]+\.groundhog\.io\//,
  /^https:\/\/localhost:\d+\//,
  /^http:\/\/localhost:\d+\//,
];

export function validateRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    // Check against allowed patterns
    return ALLOWED_REDIRECT_PATTERNS.some((pattern) => pattern.test(url));
  } catch {
    return false;
  }
}

// Sanitize string input to prevent injection
export function sanitizeString(input: string, maxLength: number = 1000): string {
  if (typeof input !== 'string') {
    throw new BadRequestError('Expected string input');
  }
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  // Truncate to max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

// Validate UUID format
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export function validateUuid(id: string, fieldName: string = 'id'): void {
  if (!isValidUuid(id)) {
    throw new BadRequestError(`Invalid ${fieldName} format`);
  }
}

// Validate email format
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

export function validateEmail(email: string): void {
  if (!isValidEmail(email)) {
    throw new BadRequestError('Invalid email format');
  }
}

// Rate limit key generation
export function getRateLimitKey(ip: string, route: string): string {
  return `ratelimit:${ip}:${route}`;
}

// Mask sensitive data for logging
export function maskSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveFields = ['password', 'apikey', 'token', 'secret', 'authorization'];
  const masked: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some((field) => lowerKey.includes(field))) {
      masked[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      masked[key] = maskSensitiveData(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }

  return masked;
}

// Validate pagination parameters
export interface PaginationParams {
  limit: number;
  offset: number;
}

export function validatePagination(
  limit?: string | number,
  offset?: string | number,
  maxLimit: number = 100
): PaginationParams {
  let parsedLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit ?? 20;
  let parsedOffset = typeof offset === 'string' ? parseInt(offset, 10) : offset ?? 0;

  if (isNaN(parsedLimit) || parsedLimit < 1) {
    parsedLimit = 20;
  }
  if (parsedLimit > maxLimit) {
    parsedLimit = maxLimit;
  }

  if (isNaN(parsedOffset) || parsedOffset < 0) {
    parsedOffset = 0;
  }

  return { limit: parsedLimit, offset: parsedOffset };
}

// Content type validation
export function validateContentType(
  contentType: string | undefined,
  expectedTypes: string[]
): void {
  if (!contentType) {
    throw new BadRequestError('Content-Type header is required');
  }
  const normalizedType = contentType.split(';')[0].trim().toLowerCase();
  if (!expectedTypes.includes(normalizedType)) {
    throw new BadRequestError(
      `Invalid Content-Type. Expected: ${expectedTypes.join(' or ')}`
    );
  }
}

// IP address validation
const IPV6_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= 0 && num <= 255 && part === String(num);
  });
}

export function isValidIpAddress(ip: string): boolean {
  return isValidIPv4(ip) || IPV6_REGEX.test(ip);
}

// Extract client IP from request (handles proxies)
export function getClientIp(
  xForwardedFor: string | undefined,
  remoteAddress: string | undefined
): string {
  if (xForwardedFor) {
    // Take the first IP from X-Forwarded-For header
    const firstIp = xForwardedFor.split(',')[0].trim();
    if (isValidIpAddress(firstIp)) {
      return firstIp;
    }
  }
  return remoteAddress || 'unknown';
}

// Secure comparison to prevent timing attacks
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
