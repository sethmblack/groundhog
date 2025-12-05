import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ReportingService } from '@/services/reporting-service';
import { requireOrg } from '@/middleware/auth';
import { BadRequestError } from '@/lib/errors';

const DateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function registerReportRoutes(
  app: FastifyInstance,
  reportingService: ReportingService
): void {
  // GET /organizations/:orgId/reports/usage - Get usage report
  app.get('/organizations/:orgId/reports/usage', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const query = request.query as { startDate?: string; endDate?: string };

      const validation = DateRangeSchema.safeParse(query);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      // Default to last 30 days
      const now = new Date();
      const endDate = validation.data.endDate || now.toISOString().split('T')[0];
      const startDate =
        validation.data.startDate ||
        new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split('T')[0];

      const report = await reportingService.getUsageReport(
        orgId,
        startDate,
        endDate
      );

      return reply.send(report);
    },
  });

  // GET /organizations/:orgId/reports/backups - Get backup summary by day
  app.get('/organizations/:orgId/reports/backups', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const query = request.query as { days?: string };

      const days = query.days ? parseInt(query.days, 10) : 30;
      if (isNaN(days) || days < 1 || days > 365) {
        throw new BadRequestError('Days must be between 1 and 365');
      }

      const summary = await reportingService.getBackupSummaryByDay(orgId, days);

      return reply.send({ summary });
    },
  });

  // GET /organizations/:orgId/reports/audit - Get audit summary
  app.get('/organizations/:orgId/reports/audit', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId } = request.params as { orgId: string };
      const query = request.query as { startDate?: string; endDate?: string };

      const validation = DateRangeSchema.safeParse(query);
      if (!validation.success) {
        throw new BadRequestError(validation.error.errors[0].message);
      }

      const summary = await reportingService.getAuditSummary(
        orgId,
        validation.data.startDate,
        validation.data.endDate
      );

      return reply.send({ summary });
    },
  });

  // GET /organizations/:orgId/reports/dashboards/:dashboardGuid - Get dashboard backup history
  app.get('/organizations/:orgId/reports/dashboards/:dashboardGuid', {
    preHandler: [app.authenticate, requireOrg() as never],
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      const { orgId, dashboardGuid } = request.params as {
        orgId: string;
        dashboardGuid: string;
      };
      const query = request.query as { limit?: string };

      const limit = query.limit ? parseInt(query.limit, 10) : 50;
      if (isNaN(limit) || limit < 1 || limit > 200) {
        throw new BadRequestError('Limit must be between 1 and 200');
      }

      const history = await reportingService.getDashboardBackupHistory(
        orgId,
        dashboardGuid,
        limit
      );

      return reply.send({ history });
    },
  });
}
