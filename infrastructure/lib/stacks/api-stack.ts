import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface ApiStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  table: dynamodb.ITable;
  backupBucket: s3.IBucket;
  userPool: cognito.IUserPool;
  backupQueue: sqs.IQueue;
  notificationQueue: sqs.IQueue;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, table, backupBucket, userPool, backupQueue, notificationQueue } = props;

    // Lambda execution role
    const lambdaRole = new iam.Role(this, 'ApiHandlerRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant permissions
    table.grantReadWriteData(lambdaRole);
    backupBucket.grantReadWrite(lambdaRole);
    backupQueue.grantSendMessages(lambdaRole);
    notificationQueue.grantSendMessages(lambdaRole);

    // Secrets Manager permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:CreateSecret',
          'secretsmanager:UpdateSecret',
          'secretsmanager:DeleteSecret',
        ],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:groundhog/*`,
        ],
      })
    );

    // X-Ray permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      })
    );

    // Log group
    const logGroup = new logs.LogGroup(this, 'ApiHandlerLogs', {
      logGroupName: `/aws/lambda/groundhog-${config.environment}-api-handler`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Handler Lambda
    this.apiHandler = new lambda.Function(this, 'ApiHandler', {
      functionName: `groundhog-${config.environment}-api-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        exports.handler = async (event) => {
          return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Groundhog API - placeholder' }),
          };
        };
      `),
      memorySize: config.lambdaMemoryMB,
      timeout: cdk.Duration.seconds(config.lambdaTimeoutSeconds),
      role: lambdaRole,
      environment: {
        NODE_ENV: config.environment,
        DYNAMODB_TABLE: table.tableName,
        S3_BUCKET: backupBucket.bucketName,
        BACKUP_QUEUE_URL: backupQueue.queueUrl,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
      },
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'CognitoAuthorizer',
      {
        cognitoUserPools: [userPool],
        authorizerName: `groundhog-${config.environment}-authorizer`,
        identitySource: 'method.request.header.Authorization',
      }
    );

    // API Gateway
    this.api = new apigateway.RestApi(this, 'Api', {
      restApiName: `groundhog-${config.environment}-api`,
      description: 'Groundhog Dashboard Backup API',
      deployOptions: {
        stageName: config.environment,
        tracingEnabled: true,
        metricsEnabled: config.enableDetailedMonitoring,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.environment !== 'prod',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
        maxAge: cdk.Duration.days(1),
      },
    });

    // Lambda Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(this.apiHandler);

    // Health check (public)
    const health = this.api.root.addResource('health');
    health.addMethod('GET', lambdaIntegration);

    // Auth endpoints (public)
    const auth = this.api.root.addResource('auth');
    auth.addResource('login').addMethod('POST', lambdaIntegration);
    auth.addResource('register').addMethod('POST', lambdaIntegration);
    auth.addResource('refresh').addMethod('POST', lambdaIntegration);
    auth.addResource('forgot-password').addMethod('POST', lambdaIntegration);
    auth.addResource('reset-password').addMethod('POST', lambdaIntegration);

    // Protected endpoints
    const methodOptions: apigateway.MethodOptions = {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    };

    // Users
    const users = this.api.root.addResource('users');
    users.addResource('me').addMethod('GET', lambdaIntegration, methodOptions);

    // Organizations
    const organizations = this.api.root.addResource('organizations');
    organizations.addMethod('GET', lambdaIntegration, methodOptions);
    organizations.addMethod('POST', lambdaIntegration, methodOptions);

    const org = organizations.addResource('{orgId}');
    org.addMethod('GET', lambdaIntegration, methodOptions);
    org.addMethod('PUT', lambdaIntegration, methodOptions);
    org.addMethod('DELETE', lambdaIntegration, methodOptions);

    // API Keys
    const apiKeys = org.addResource('api-keys');
    apiKeys.addMethod('GET', lambdaIntegration, methodOptions);
    apiKeys.addMethod('POST', lambdaIntegration, methodOptions);

    const apiKey = apiKeys.addResource('{keyId}');
    apiKey.addMethod('GET', lambdaIntegration, methodOptions);
    apiKey.addMethod('PUT', lambdaIntegration, methodOptions);
    apiKey.addMethod('DELETE', lambdaIntegration, methodOptions);
    apiKey.addResource('validate').addMethod('POST', lambdaIntegration, methodOptions);

    // Dashboards
    const dashboards = org.addResource('dashboards');
    dashboards.addMethod('GET', lambdaIntegration, methodOptions);

    const dashboard = dashboards.addResource('{guid}');
    dashboard.addMethod('GET', lambdaIntegration, methodOptions);
    dashboard.addResource('versions').addMethod('GET', lambdaIntegration, methodOptions);
    dashboard.addResource('restore').addMethod('POST', lambdaIntegration, methodOptions);

    // Backup
    const backup = org.addResource('backup');
    backup.addResource('trigger').addMethod('POST', lambdaIntegration, methodOptions);

    // Webhooks (public with signature verification)
    const webhooks = this.api.root.addResource('webhooks');
    webhooks.addResource('stripe').addMethod('POST', lambdaIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `groundhog-${config.environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      exportName: `groundhog-${config.environment}-api-id`,
    });
  }
}
