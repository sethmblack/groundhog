export type Environment = 'dev' | 'staging' | 'prod';

export interface EnvironmentConfig {
  environment: Environment;
  account: string;
  region: string;
  domainName?: string;

  // Scaling
  lambdaMemoryMB: number;
  lambdaTimeoutSeconds: number;
  dynamodbBillingMode: 'PAY_PER_REQUEST' | 'PROVISIONED';

  // Features
  enableWaf: boolean;
  enableDetailedMonitoring: boolean;
  logRetentionDays: number;

  // Tags
  tags: Record<string, string>;
}

export const environments: Record<Environment, EnvironmentConfig> = {
  dev: {
    environment: 'dev',
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '282176177048',
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-2',
    lambdaMemoryMB: 256,
    lambdaTimeoutSeconds: 30,
    dynamodbBillingMode: 'PAY_PER_REQUEST',
    enableWaf: false,
    enableDetailedMonitoring: false,
    logRetentionDays: 7,
    tags: {
      Environment: 'dev',
      Project: 'groundhog',
      ManagedBy: 'cdk',
    },
  },
  staging: {
    environment: 'staging',
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '282176177048',
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-2',
    lambdaMemoryMB: 512,
    lambdaTimeoutSeconds: 30,
    dynamodbBillingMode: 'PAY_PER_REQUEST',
    enableWaf: true,
    enableDetailedMonitoring: true,
    logRetentionDays: 14,
    tags: {
      Environment: 'staging',
      Project: 'groundhog',
      ManagedBy: 'cdk',
    },
  },
  prod: {
    environment: 'prod',
    account: process.env.CDK_DEFAULT_ACCOUNT ?? '282176177048',
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-2',
    domainName: 'groundhog.example.com',
    lambdaMemoryMB: 1024,
    lambdaTimeoutSeconds: 30,
    dynamodbBillingMode: 'PAY_PER_REQUEST',
    enableWaf: true,
    enableDetailedMonitoring: true,
    logRetentionDays: 90,
    tags: {
      Environment: 'prod',
      Project: 'groundhog',
      ManagedBy: 'cdk',
    },
  },
};

export function getConfig(env: Environment): EnvironmentConfig {
  return environments[env];
}
