import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BackupService } from '@/services/backup-service';
import { ApiKeyService } from '@/services/apikey-service';
import { requireOrg } from '@/middleware/auth';
import { BadRequestError } from '@/lib/errors';
import { PaginationSchema } from '@/types';

const TriggerBackupSchema = z.object({
  apiKeyId: z.string().uuid(),
  accountId: z.string().optional(),
});

const BackupDashboardSchema = z.object({
  apiKeyId: z.string().uuid(),
});

export function registerDashboardRoutes(
  app: FastifyInstance,
  backupService: BackupService,
  apiKeyService: ApiKeyService
): void {
  // GET /organizations/:orgId/dashboards - List dashboards (from New Relic)
  app.get('/organizations/:orgId/dashboards', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const { apiKeyId, accountId } = request.query as {
        apiKeyId?: string;
        accountId?: string;
      };

      if (!apiKeyId) {
        throw new BadRequestError('apiKeyId query parameter is required');
      }

      const nrClient = await apiKeyService.getNewRelicClient(orgId, apiKeyId);

      if (!accountId) {
        throw new BadRequestError('accountId query parameter is required');
      }

      const dashboards = await nrClient.listDashboards(accountId);

      return reply.send({
        data: dashboards,
        total: dashboards.length,
      });
    },
  });

  // GET /organizations/:orgId/dashboards/:guid - Get dashboard details
  app.get('/organizations/:orgId/dashboards/:guid', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, guid } = request.params as { orgId: string; guid: string };
      const { apiKeyId } = request.query as { apiKeyId?: string };

      if (!apiKeyId) {
        throw new BadRequestError('apiKeyId query parameter is required');
      }

      const nrClient = await apiKeyService.getNewRelicClient(orgId, apiKeyId);
      const dashboard = await nrClient.getDashboard(guid);

      if (!dashboard) {
        return reply.status(404).send({ error: 'Dashboard not found' });
      }

      return reply.send(dashboard);
    },
  });

  // GET /organizations/:orgId/dashboards/:guid/versions - List backup versions
  app.get('/organizations/:orgId/dashboards/:guid/versions', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, guid } = request.params as { orgId: string; guid: string };
      const pagination = PaginationSchema.parse(request.query);

      const result = await backupService.listBackupsByDashboard(
        orgId,
        guid,
        pagination
      );

      return reply.send(result);
    },
  });

  // POST /organizations/:orgId/dashboards/:guid/backup - Backup single dashboard
  app.post('/organizations/:orgId/dashboards/:guid/backup', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, guid } = request.params as { orgId: string; guid: string };
      const validation = BackupDashboardSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const result = await backupService.backupDashboard({
        orgId,
        apiKeyId: validation.data.apiKeyId,
        dashboardGuid: guid,
      });

      return reply.status(201).send(result);
    },
  });

  // GET /organizations/:orgId/backups - List all backups for org
  app.get('/organizations/:orgId/backups', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const pagination = PaginationSchema.parse(request.query);

      const result = await backupService.listBackupsByOrg(orgId, pagination);

      return reply.send(result);
    },
  });

  // GET /organizations/:orgId/backups/:snapshotId - Get backup details
  app.get('/organizations/:orgId/backups/:snapshotId', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, snapshotId } = request.params as {
        orgId: string;
        snapshotId: string;
      };

      const backup = await backupService.getBackup(orgId, snapshotId);

      return reply.send(backup);
    },
  });

  // GET /organizations/:orgId/backups/:snapshotId/content - Get backup content
  app.get('/organizations/:orgId/backups/:snapshotId/content', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, snapshotId } = request.params as {
        orgId: string;
        snapshotId: string;
      };

      const content = await backupService.getBackupContent(orgId, snapshotId);

      return reply
        .header('Content-Type', 'application/json')
        .send(JSON.parse(content));
    },
  });

  // POST /organizations/:orgId/backup/trigger - Trigger backup for all dashboards
  app.post('/organizations/:orgId/backup/trigger', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const validation = TriggerBackupSchema.safeParse(request.body);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const results = await backupService.backupAllDashboards({
        orgId,
        apiKeyId: validation.data.apiKeyId,
        accountId: validation.data.accountId,
      });

      return reply.status(202).send({
        message: 'Backup triggered',
        resultsCount: results.length,
        results,
      });
    },
  });

  // GET /organizations/:orgId/backup/stats - Get storage statistics
  app.get('/organizations/:orgId/backup/stats', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };

      const stats = await backupService.getStorageStats(orgId);

      return reply.send(stats);
    },
  });
}
