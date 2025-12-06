import awsLambdaFastify from '@fastify/aws-lambda';
import type { APIGatewayProxyEvent, Context, APIGatewayProxyResult } from 'aws-lambda';
import { buildApp } from './app';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;
let proxy: ReturnType<typeof awsLambdaFastify> | null = null;

async function getProxy() {
  // Return cached proxy if available (warm start)
  if (proxy && app) {
    return proxy;
  }

  // Build the app only on cold start
  app = await buildApp({
    cognito: {
      userPoolId: process.env.COGNITO_USER_POOL_ID!,
      clientId: process.env.COGNITO_CLIENT_ID!,
      region: process.env.AWS_REGION || 'us-east-2',
    },
    cors: {
      origin: process.env.CORS_ORIGIN || '*',
    },
    rateLimit: {
      max: 100,
      timeWindow: '1 minute',
    },
  });

  // Create the Lambda proxy handler BEFORE calling ready()
  // awsLambdaFastify will call ready() internally
  proxy = awsLambdaFastify(app);
  return proxy;
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  // Keep the Lambda container warm
  context.callbackWaitsForEmptyEventLoop = false;

  const proxyHandler = await getProxy();
  return proxyHandler(event, context);
};
