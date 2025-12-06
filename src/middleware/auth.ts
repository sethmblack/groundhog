import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { verifyToken, extractBearerToken, JwtConfig } from '@/lib/jwt';
import { RequestContext, OrgContext, Role } from '@/types';
import { UnauthorizedError, ForbiddenError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { OrganizationRepository } from '@/repositories/organization-repository';

// Module-level reference to org repository for DynamoDB lookups
let orgRepository: OrganizationRepository | null = null;

export function setOrgRepository(repo: OrganizationRepository): void {
  orgRepository = repo;
}

declare module 'fastify' {
  interface FastifyRequest {
    ctx?: RequestContext;
    orgCtx?: OrgContext;
  }
}

export function createAuthMiddleware(config: JwtConfig) {
  return async function authenticate(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    try {
      const token = extractBearerToken(request.headers.authorization);
      const claims = await verifyToken(token, config);

      request.ctx = {
        requestId: request.id,
        userId: claims.sub,
        email: claims.email,
        orgs: claims.orgs,
      };

      logger.debug({ userId: claims.sub, email: claims.email }, 'User authenticated');
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        throw error;
      }
      logger.error({ error }, 'Authentication failed');
      throw new UnauthorizedError('Authentication failed');
    }
  };
}

export function requireOrg(
  allowedRoles: Role[] = ['USER', 'ADMIN', 'SUPERUSER']
) {
  return async function checkOrgAccess(
    request: FastifyRequest<{ Params: { orgId: string } }>,
    _reply: FastifyReply
  ): Promise<void> {
    if (!request.ctx) {
      throw new UnauthorizedError('Authentication required');
    }

    const { orgId } = request.params;
    if (!orgId) {
      throw new ForbiddenError('Organization ID required');
    }

    // First check JWT claims for membership
    let membership = request.ctx.orgs.find((o) => o.orgId === orgId);

    // If not in JWT claims, query DynamoDB as fallback
    if (!membership && orgRepository) {
      logger.debug(
        { userId: request.ctx.userId, orgId },
        'Membership not in JWT, checking DynamoDB'
      );
      const dbMembership = await orgRepository.getMembership(request.ctx.userId, orgId);
      if (dbMembership) {
        membership = { orgId: dbMembership.orgId, role: dbMembership.role };
        // Add to ctx.orgs for future checks in this request
        request.ctx.orgs.push(membership);
      }
    }

    if (!membership) {
      throw new ForbiddenError('Not a member of this organization');
    }

    if (!allowedRoles.includes(membership.role)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    request.orgCtx = {
      ...request.ctx,
      orgId,
      role: membership.role,
    };

    logger.debug(
      { userId: request.ctx.userId, orgId, role: membership.role },
      'Organization access granted'
    );
  };
}

export function requireAdmin() {
  return requireOrg(['ADMIN', 'SUPERUSER']);
}

export function requireSuperuser() {
  return requireOrg(['SUPERUSER']);
}

export function registerAuthHooks(app: FastifyInstance, config: JwtConfig): void {
  app.decorateRequest('ctx', null);
  app.decorateRequest('orgCtx', null);

  // Add helper to get current user
  app.decorate('authenticate', createAuthMiddleware(config));
}
