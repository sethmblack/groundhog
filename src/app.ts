import Fastify, { FastifyInstance, FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { v4 as uuid } from 'uuid';

import { logger } from '@/lib/logger';
import { AppError, isAppError, InternalError } from '@/lib/errors';
import { registerAuthHooks, setOrgRepository } from '@/middleware/auth';
import { JwtConfig } from '@/lib/jwt';

// Handlers
import { registerHealthRoutes } from '@/handlers/api/health';
import { registerAuthRoutes } from '@/handlers/api/auth';
import { registerUserRoutes } from '@/handlers/api/users';
import { registerOrganizationRoutes } from '@/handlers/api/organizations';
import { registerApiKeyRoutes } from '@/handlers/api/apikeys';
import { registerDashboardRoutes } from '@/handlers/api/dashboards';
import { registerRestoreRoutes } from '@/handlers/api/restore';
import { registerBillingRoutes } from '@/handlers/api/billing';
import { registerReportRoutes } from '@/handlers/api/reports';

// Services & Repositories
import { AuthService } from '@/services/auth-service';
import { OrganizationService } from '@/services/organization-service';
import { ApiKeyService } from '@/services/apikey-service';
import { BackupService } from '@/services/backup-service';
import { RestoreService } from '@/services/restore-service';
import { BillingService } from '@/services/billing-service';
import { ReportingService } from '@/services/reporting-service';
import { AuditRepository } from '@/repositories/audit-repository';
import { UserRepository } from '@/repositories/user-repository';
import { OrganizationRepository } from '@/repositories/organization-repository';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { BackupRepository } from '@/repositories/backup-repository';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: ReturnType<typeof createAuthMiddleware>;
  }
}

export interface AppConfig {
  cognito: {
    userPoolId: string;
    clientId: string;
    region: string;
  };
  rateLimit?: {
    max: number;
    timeWindow: string;
  };
  cors?: {
    origin: string | string[];
  };
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own logger
    genReqId: () => uuid(),
    trustProxy: true,
  });

  // Security middleware
  await app.register(helmet, {
    contentSecurityPolicy: false, // API only
  });

  // CORS
  await app.register(cors, {
    origin: config.cors?.origin || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: config.rateLimit?.max || 100,
    timeWindow: config.rateLimit?.timeWindow || '1 minute',
  });

  // Request logging
  app.addHook('onRequest', async (request) => {
    // Use app logger for request context
    logger.debug({
      requestId: request.id,
      method: request.method,
      url: request.url,
    }, 'Request started');
  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  // Error handling
  app.setErrorHandler(
    async (error: FastifyError | AppError, request: FastifyRequest, reply: FastifyReply) => {
      const requestId = request.id;

      if (isAppError(error)) {
        if (!error.isOperational) {
          logger.error(
            { requestId, error: error.message, stack: error.stack },
            'Non-operational error'
          );
        } else {
          logger.warn({ requestId, error: error.message }, 'Operational error');
        }

        return reply.status(error.statusCode).send({
          ...error.toJSON(),
          requestId,
        });
      }

      // Handle Fastify validation errors
      if (error.validation) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
          requestId,
        });
      }

      // Unknown errors
      logger.error(
        { requestId, error: error.message, stack: error.stack },
        'Unhandled error'
      );

      const internalError = new InternalError('An unexpected error occurred');
      return reply.status(500).send({
        ...internalError.toJSON(),
        requestId,
      });
    }
  );

  // JWT config
  const jwtConfig: JwtConfig = {
    userPoolId: config.cognito.userPoolId,
    clientId: config.cognito.clientId,
    region: config.cognito.region,
  };

  // Register auth hooks and middleware (this also decorates 'authenticate')
  registerAuthHooks(app, jwtConfig);

  // Initialize repositories
  const userRepository = new UserRepository();
  const orgRepository = new OrganizationRepository();
  const apiKeyRepository = new ApiKeyRepository();

  // Set org repository for auth middleware DynamoDB lookups
  setOrgRepository(orgRepository);

  // Initialize services
  const authService = new AuthService(
    {
      userPoolId: config.cognito.userPoolId,
      clientId: config.cognito.clientId,
      region: config.cognito.region,
    },
    userRepository
  );

  const orgService = new OrganizationService(
    orgRepository,
    userRepository,
    authService
  );

  const apiKeyService = new ApiKeyService(apiKeyRepository);
  const backupRepository = new BackupRepository();
  const backupService = new BackupService(backupRepository, apiKeyService, apiKeyRepository);
  const restoreService = new RestoreService(backupService, apiKeyService, backupRepository, apiKeyRepository);
  const billingService = new BillingService(orgRepository);
  const auditRepository = new AuditRepository();
  const reportingService = new ReportingService(
    backupRepository,
    auditRepository,
    apiKeyRepository,
    orgRepository
  );

  // Register routes
  registerHealthRoutes(app);
  registerAuthRoutes(app, authService);
  registerUserRoutes(app, userRepository);
  registerOrganizationRoutes(app, orgService);
  registerApiKeyRoutes(app, apiKeyService, orgService, backupService);
  registerDashboardRoutes(app, backupService, apiKeyService);
  registerRestoreRoutes(app, restoreService);
  registerBillingRoutes(app, billingService);
  registerReportRoutes(app, reportingService);

  return app;
}

export async function startServer(app: FastifyInstance, port: number): Promise<void> {
  try {
    await app.listen({ port, host: '0.0.0.0' });
    logger.info({ port }, 'Server started');
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    throw error;
  }
}
