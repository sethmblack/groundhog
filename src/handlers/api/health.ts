import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  // GET /health - Health check
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env['APP_VERSION'] || '1.0.0',
    });
  });

  // GET /health/ready - Readiness check
  app.get('/health/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Could add checks for DynamoDB, S3, etc.
    return reply.send({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  });

  // GET /health/live - Liveness check
  app.get('/health/live', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      status: 'live',
      timestamp: new Date().toISOString(),
    });
  });
}
