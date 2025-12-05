import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ApiKeyService } from '@/services/apikey-service';
import { OrganizationService } from '@/services/organization-service';
import { requireOrg, requireAdmin } from '@/middleware/auth';
import { BadRequestError } from '@/lib/errors';
import { PaginationSchema } from '@/types';

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  newRelicApiKey: z.string().min(1),
});

const UpdateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  newRelicApiKey: z.string().min(1).optional(),
});

export function registerApiKeyRoutes(
  app: FastifyInstance,
  apiKeyService: ApiKeyService,
  orgService: OrganizationService
): void {
  // GET /organizations/:orgId/api-keys - List API keys
  app.get('/organizations/:orgId/api-keys', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const pagination = PaginationSchema.parse(request.query);

      const result = await apiKeyService.list(orgId, pagination);

      // Mask secret ARNs in response
      const maskedData = result.data.map((key) => ({
        ...key,
        secretArn: '***',
      }));

      return reply.send({
        ...result,
        data: maskedData,
      });
    },
  });

  // POST /organizations/:orgId/api-keys - Create API key
  app.post('/organizations/:orgId/api-keys', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const validation = CreateApiKeySchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      // Get org to check subscription tier
      const org = await orgService.getById(orgId);

      const apiKey = await apiKeyService.create(
        {
          orgId,
          name: validation.data.name,
          newRelicApiKey: validation.data.newRelicApiKey,
          createdBy: request.ctx!.userId,
        },
        org.subscriptionTier
      );

      // Mask secret ARN in response
      return reply.status(201).send({
        ...apiKey,
        secretArn: '***',
      });
    },
  });

  // GET /organizations/:orgId/api-keys/:keyId - Get API key
  app.get('/organizations/:orgId/api-keys/:keyId', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };

      const apiKey = await apiKeyService.getById(orgId, keyId);

      return reply.send({
        ...apiKey,
        secretArn: '***',
      });
    },
  });

  // PUT /organizations/:orgId/api-keys/:keyId - Update API key
  app.put('/organizations/:orgId/api-keys/:keyId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };
      const validation = UpdateApiKeySchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const apiKey = await apiKeyService.update(orgId, keyId, validation.data);

      return reply.send({
        ...apiKey,
        secretArn: '***',
      });
    },
  });

  // DELETE /organizations/:orgId/api-keys/:keyId - Delete API key
  app.delete('/organizations/:orgId/api-keys/:keyId', {
    preHandler: [app.authenticate, requireAdmin() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };

      await apiKeyService.delete(orgId, keyId);

      return reply.status(204).send();
    },
  });

  // POST /organizations/:orgId/api-keys/:keyId/validate - Validate API key
  app.post('/organizations/:orgId/api-keys/:keyId/validate', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, keyId } = request.params as { orgId: string; keyId: string };

      const result = await apiKeyService.validate(orgId, keyId);

      return reply.send({
        valid: result.valid,
        accounts: result.accounts,
        validatedAt: new Date().toISOString(),
      });
    },
  });
}
