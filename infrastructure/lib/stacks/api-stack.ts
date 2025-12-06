import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import * as path from 'path';
import { EnvironmentConfig } from '../config/environments';

export interface ApiStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  table: dynamodb.ITable;
  backupBucket: s3.IBucket;
  userPool: cognito.IUserPool;
  userPoolClientId: string;
  backupQueue: sqs.IQueue;
  notificationQueue: sqs.IQueue;
  encryptionKey: kms.IKey;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiHandler: lambda.Function;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { config, table, backupBucket, userPool, userPoolClientId, backupQueue, notificationQueue } = props;

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
          'secretsmanager:TagResource',
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

    // API Handler Lambda with bundled code
    this.apiHandler = new lambdaNodejs.NodejsFunction(this, 'ApiHandler', {
      functionName: `groundhog-${config.environment}-api-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../src/lambda.ts'),
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
        COGNITO_CLIENT_ID: userPoolClientId,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: true,
        sourceMapMode: lambdaNodejs.SourceMapMode.INLINE,
        target: 'node20',
        externalModules: [
          '@aws-sdk/*', // AWS SDK v3 is included in Lambda runtime
        ],
        tsconfig: path.join(__dirname, '../../../tsconfig.json'),
        banner: '/* Groundhog API - bundled with esbuild */',
        // Resolve TypeScript path aliases
        define: {
          'process.env.NODE_ENV': JSON.stringify(config.environment),
        },
        // esbuild alias to resolve @/* paths
        esbuildArgs: {
          '--alias:@/*': path.join(__dirname, '../../../src/*'),
        },
      },
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

    // Add Gateway Responses for CORS on 4XX errors
    // This ensures CORS headers are returned even when Cognito authorizer rejects requests
    this.api.addGatewayResponse('UnauthorizedResponse', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
      templates: {
        'application/json': '{"message": "$context.error.messageString", "requestId": "$context.requestId"}',
      },
    });

    this.api.addGatewayResponse('AccessDeniedResponse', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
      templates: {
        'application/json': '{"message": "$context.error.messageString", "requestId": "$context.requestId"}',
      },
    });

    this.api.addGatewayResponse('Default4XXResponse', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
    });

    this.api.addGatewayResponse('Default5XXResponse', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Api-Key'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,PUT,POST,DELETE,PATCH,HEAD'",
      },
    });

    // Lambda Integration with proxy
    const lambdaIntegration = new apigateway.LambdaIntegration(this.apiHandler, {
      proxy: true,
    });

    // Use a single proxy route to avoid Lambda permission policy size limits
    // The Lambda handles all routing internally
    const proxyResource = this.api.root.addResource('{proxy+}');
    proxyResource.addMethod('ANY', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // Root endpoint for health checks (public)
    this.api.root.addMethod('GET', lambdaIntegration);

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      exportName: `groundhog-${config.environment}-api-url`,
    });

    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      exportName: `groundhog-${config.environment}-api-id`,
    });

    // ============================================
    // Backup Processor Lambda (SQS Consumer)
    // ============================================

    // Backup processor execution role
    const backupProcessorRole = new iam.Role(this, 'BackupProcessorRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant permissions for backup processor
    table.grantReadWriteData(backupProcessorRole);
    backupBucket.grantReadWrite(backupProcessorRole);
    backupQueue.grantConsumeMessages(backupProcessorRole);
    notificationQueue.grantSendMessages(backupProcessorRole);

    // KMS permissions for decrypting queue messages
    props.encryptionKey.grantDecrypt(backupProcessorRole);

    // Secrets Manager permissions for reading API keys
    backupProcessorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${config.region}:${config.account}:secret:groundhog/*`,
        ],
      })
    );

    // X-Ray permissions
    backupProcessorRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
        resources: ['*'],
      })
    );

    // Backup processor log group
    const backupProcessorLogGroup = new logs.LogGroup(this, 'BackupProcessorLogs', {
      logGroupName: `/aws/lambda/groundhog-${config.environment}-backup-processor`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Backup Processor Lambda
    const backupProcessor = new lambdaNodejs.NodejsFunction(this, 'BackupProcessor', {
      functionName: `groundhog-${config.environment}-backup-processor`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: path.join(__dirname, '../../../src/handlers/queue/backup-processor.ts'),
      memorySize: 1024, // More memory for processing many dashboards
      timeout: cdk.Duration.minutes(5), // Match SQS visibility timeout
      role: backupProcessorRole,
      environment: {
        NODE_ENV: config.environment,
        DYNAMODB_TABLE: table.tableName,
        S3_BUCKET: backupBucket.bucketName,
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
      tracing: lambda.Tracing.ACTIVE,
      logGroup: backupProcessorLogGroup,
      bundling: {
        minify: true,
        sourceMap: true,
        sourceMapMode: lambdaNodejs.SourceMapMode.INLINE,
        target: 'node20',
        externalModules: ['@aws-sdk/*'],
        tsconfig: path.join(__dirname, '../../../tsconfig.json'),
        banner: '/* Groundhog Backup Processor - bundled with esbuild */',
        define: {
          'process.env.NODE_ENV': JSON.stringify(config.environment),
        },
        esbuildArgs: {
          '--alias:@/*': path.join(__dirname, '../../../src/*'),
        },
      },
    });

    // Connect SQS queue to Lambda
    backupProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(backupQueue, {
        batchSize: 1, // Process one backup job at a time
        maxConcurrency: 5, // Allow up to 5 concurrent backup processors
      })
    );

    new cdk.CfnOutput(this, 'BackupProcessorArn', {
      value: backupProcessor.functionArn,
      exportName: `groundhog-${config.environment}-backup-processor-arn`,
    });
  }
}
