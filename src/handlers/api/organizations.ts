import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { OrganizationService } from '@/services/organization-service';
import { requireOrg, requireAdmin } from '@/middleware/auth';
import { BadRequestError, ForbiddenError } from '@/lib/errors';
import { PaginationSchema, RoleSchema } from '@/types';

// Request schemas
const CreateOrgSchema = z.object({
  name: z.string().min(1).max(200),
});

const UpdateOrgSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  settings: z.record(z.unknown()).optional(),
});

const AddMemberSchema = z.object({
  email: z.string().email(),
  role: RoleSchema,
});

const UpdateMemberRoleSchema = z.object({
  role: RoleSchema,
});

export function registerOrganizationRoutes(
  app: FastifyInstance,
  orgService: OrganizationService
): void {
  // GET /organizations - List user's organizations
  app.get('/organizations', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const pagination = PaginationSchema.parse(request.query);
      const result = await orgService.listForUser(request.ctx!.userId, pagination);
      return reply.send(result);
    },
  });

  // POST /organizations - Create organization
  app.post('/organizations', {
    preHandler: [app.authenticate],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const validation = CreateOrgSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const org = await orgService.create({
        name: validation.data.name,
        createdBy: request.ctx!.userId,
        createdByEmail: request.ctx!.email,
      });

      return reply.status(201).send(org);
    },
  });

  // GET /organizations/:orgId - Get organization
  app.get('/organizations/:orgId', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const org = await orgService.getById(orgId);
      return reply.send(org);
    },
  });

  // PUT /organizations/:orgId - Update organization
  app.put('/organizations/:orgId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const validation = UpdateOrgSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const org = await orgService.update(orgId, validation.data, request.ctx!.userId);
      return reply.send(org);
    },
  });

  // DELETE /organizations/:orgId - Delete organization
  app.delete('/organizations/:orgId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      await orgService.delete(orgId, request.ctx!.userId);
      return reply.status(204).send();
    },
  });

  // GET /organizations/:orgId/members - List members
  app.get('/organizations/:orgId/members', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const pagination = PaginationSchema.parse(request.query);
      const result = await orgService.getMembers(orgId, pagination);
      return reply.send(result);
    },
  });

  // POST /organizations/:orgId/members - Add member
  app.post('/organizations/:orgId/members', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const validation = AddMemberSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      // Only superusers can add superusers
      if (
        validation.data.role === 'SUPERUSER' &&
        request.orgCtx!.role !== 'SUPERUSER'
      ) {
        throw new ForbiddenError('Only superusers can add superusers');
      }

      const membership = await orgService.addMember(orgId, {
        email: validation.data.email,
        role: validation.data.role,
        invitedBy: request.ctx!.userId,
      });

      return reply.status(201).send(membership);
    },
  });

  // PUT /organizations/:orgId/members/:userId - Update member role
  app.put('/organizations/:orgId/members/:userId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, userId } = request.params as { orgId: string; userId: string };
      const validation = UpdateMemberRoleSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      // Only superusers can assign superuser role
      if (
        validation.data.role === 'SUPERUSER' &&
        request.orgCtx!.role !== 'SUPERUSER'
      ) {
        throw new ForbiddenError('Only superusers can assign superuser role');
      }

      const membership = await orgService.updateMemberRole(
        orgId,
        userId,
        validation.data.role,
        request.ctx!.userId
      );

      return reply.send(membership);
    },
  });

  // DELETE /organizations/:orgId/members/:userId - Remove member
  app.delete('/organizations/:orgId/members/:userId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, userId } = request.params as { orgId: string; userId: string };
      await orgService.removeMember(orgId, userId, request.ctx!.userId);
      return reply.status(204).send();
    },
  });
}
