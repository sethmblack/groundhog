import * as jose from 'jose';
import { JwtClaims, JwtClaimsSchema, Role } from '@/types';
import { UnauthorizedError } from '@/lib/errors';
import { logger } from '@/lib/logger';

let jwks: jose.JWTVerifyGetKey | null = null;

export interface JwtConfig {
  userPoolId: string;
  region: string;
  clientId: string;
}

function getJwksUri(config: JwtConfig): string {
  return `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`;
}

function getIssuer(config: JwtConfig): string {
  return `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;
}

export async function getJwks(config: JwtConfig): Promise<jose.JWTVerifyGetKey> {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(getJwksUri(config)));
  }
  return jwks;
}

export async function verifyToken(
  token: string,
  config: JwtConfig
): Promise<JwtClaims> {
  try {
    const jwksClient = await getJwks(config);

    const { payload } = await jose.jwtVerify(token, jwksClient, {
      issuer: getIssuer(config),
      audience: config.clientId,
    });

    // Transform Cognito claims to our JwtClaims format
    const claims = transformCognitoClaims(payload);

    // Validate with zod
    const result = JwtClaimsSchema.safeParse(claims);
    if (!result.success) {
      logger.warn({ errors: result.error.errors }, 'Invalid JWT claims structure');
      throw new UnauthorizedError('Invalid token claims');
    }

    return result.data;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }

    if (error instanceof jose.errors.JWTExpired) {
      throw new UnauthorizedError('Token expired');
    }

    if (error instanceof jose.errors.JWTClaimValidationFailed) {
      throw new UnauthorizedError('Token validation failed');
    }

    logger.error({ error }, 'Token verification failed');
    throw new UnauthorizedError('Invalid token');
  }
}

interface CognitoPayload extends jose.JWTPayload {
  sub: string;
  email?: string;
  'cognito:username'?: string;
  'custom:orgs'?: string;
}

function transformCognitoClaims(payload: jose.JWTPayload): Partial<JwtClaims> {
  const cognitoPayload = payload as CognitoPayload;

  // Parse org memberships from custom claim
  let orgs: Array<{ orgId: string; role: Role }> = [];
  if (cognitoPayload['custom:orgs']) {
    try {
      orgs = JSON.parse(cognitoPayload['custom:orgs']);
    } catch {
      logger.warn('Failed to parse custom:orgs claim');
    }
  }

  return {
    sub: cognitoPayload.sub,
    email: cognitoPayload.email || cognitoPayload['cognito:username'] || '',
    orgs,
    iat: cognitoPayload.iat,
    exp: cognitoPayload.exp,
  };
}

export function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) {
    throw new UnauthorizedError('Authorization header required');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    throw new UnauthorizedError('Invalid authorization header format');
  }

  return parts[1];
}

// For testing - allows injecting a mock JWKS
export function resetJwks(): void {
  jwks = null;
}
