#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DataStack } from '../lib/stacks/data-stack';
import { AuthStack } from '../lib/stacks/auth-stack';
import { QueueStack } from '../lib/stacks/queue-stack';
import { ApiStack } from '../lib/stacks/api-stack';
import { getConfig, Environment } from '../lib/config/environments';

const app = new cdk.App();

// Get environment from context or default to 'dev'
const environmentName = (app.node.tryGetContext('environment') as Environment) || 'dev';
const config = getConfig(environmentName);

const env = {
  account: config.account,
  region: config.region,
};

// Apply tags to all resources
cdk.Tags.of(app).add('Project', 'groundhog');
cdk.Tags.of(app).add('Environment', config.environment);
cdk.Tags.of(app).add('ManagedBy', 'cdk');

// Data Stack (DynamoDB + S3)
const dataStack = new DataStack(app, `Groundhog-${config.environment}-Data`, {
  env,
  config,
  description: 'Groundhog Data Storage - DynamoDB and S3',
});

// Auth Stack (Cognito)
const authStack = new AuthStack(app, `Groundhog-${config.environment}-Auth`, {
  env,
  config,
  description: 'Groundhog Authentication - Cognito User Pool',
});

// Queue Stack (SQS)
const queueStack = new QueueStack(app, `Groundhog-${config.environment}-Queue`, {
  env,
  config,
  encryptionKey: dataStack.encryptionKey,
  description: 'Groundhog Message Queues - SQS',
});
queueStack.addDependency(dataStack);

// API Stack (API Gateway + Lambda)
const apiStack = new ApiStack(app, `Groundhog-${config.environment}-Api`, {
  env,
  config,
  table: dataStack.table,
  backupBucket: dataStack.backupBucket,
  userPool: authStack.userPool,
  backupQueue: queueStack.backupQueue,
  notificationQueue: queueStack.notificationQueue,
  description: 'Groundhog API - API Gateway and Lambda',
});
apiStack.addDependency(dataStack);
apiStack.addDependency(authStack);
apiStack.addDependency(queueStack);

app.synth();
