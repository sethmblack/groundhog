import {
  APIGatewayProxyHandler,
  APIGatewayProxyResult,
  APIGatewayProxyEvent,
  Context,
} from 'aws-lambda';
import { buildApp, AppConfig } from '@/app';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance | null = null;

const config: AppConfig = {
  cognito: {
    userPoolId: process.env['COGNITO_USER_POOL_ID'] || '',
    clientId: process.env['COGNITO_CLIENT_ID'] || '',
    region: process.env['AWS_REGION'] || 'us-east-2',
  },
  rateLimit: {
    max: 100,
    timeWindow: '1 minute',
  },
};

async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp(config);
    await app.ready();
  }
  return app;
}

function buildQueryString(
  params: APIGatewayProxyEvent['queryStringParameters']
): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');
}

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  context.callbackWaitsForEmptyEventLoop = false;

  const fastify = await getApp();
  const queryString = buildQueryString(event.queryStringParameters);
  const url = event.path + queryString;

  // Convert API Gateway event to Fastify request
  const response = await fastify.inject({
    method: event.httpMethod as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url,
    headers: event.headers as Record<string, string>,
    payload: event.body || undefined,
  });

  const result: APIGatewayProxyResult = {
    statusCode: response.statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: response.body,
  };

  return result;
};
