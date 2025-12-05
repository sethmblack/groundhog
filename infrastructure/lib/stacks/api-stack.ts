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
  }
}
