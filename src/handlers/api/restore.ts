import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { RestoreService } from '@/services/restore-service';
import { requireOrg } from '@/middleware/auth';
import { BadRequestError } from '@/lib/errors';

const RestoreSchema = z.object({
  apiKeyId: z.string().uuid(),
  targetAccountId: z.string().optional(),
  newName: z.string().min(1).max(200).optional(),
  restoreInPlace: z.boolean().optional().default(false),
});

const CompareSchema = z.object({
  apiKeyId: z.string().uuid(),
});

export function registerRestoreRoutes(
  app: FastifyInstance,
  restoreService: RestoreService
): void {
  // POST /organizations/:orgId/dashboards/:guid/restore - Restore dashboard
  app.post('/organizations/:orgId/dashboards/:guid/restore', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, guid } = request.params as { orgId: string; guid: string };
      const { snapshotId } = request.query as { snapshotId?: string };

      if (!snapshotId) {
        throw new BadRequestError('snapshotId query parameter is required');
      }

      const validation = RestoreSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const { apiKeyId, targetAccountId, newName, restoreInPlace } = validation.data;

      let result;
      if (restoreInPlace) {
        result = await restoreService.restoreInPlace({
          orgId,
          snapshotId,
          apiKeyId,
        });
      } else {
        result = await restoreService.restoreDashboard({
          orgId,
          snapshotId,
          apiKeyId,
          targetAccountId,
          newName,
        });
      }

      return reply.status(result.success ? 200 : 400).send(result);
    },
  });

  // GET /organizations/:orgId/dashboards/:guid/compare - Compare backup with current
  app.get('/organizations/:orgId/dashboards/:guid/compare', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, guid } = request.params as { orgId: string; guid: string };
      const { snapshotId, apiKeyId } = request.query as {
        snapshotId?: string;
        apiKeyId?: string;
      };

      if (!snapshotId) {
        throw new BadRequestError('snapshotId query parameter is required');
      }
      if (!apiKeyId) {
        throw new BadRequestError('apiKeyId query parameter is required');
      }

      const result = await restoreService.compareWithCurrent(orgId, snapshotId, apiKeyId);

      return reply.send(result);
    },
  });
}
