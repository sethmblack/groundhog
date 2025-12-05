import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface QueueStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  encryptionKey: kms.IKey;
}

export class QueueStack extends cdk.Stack {
  public readonly backupQueue: sqs.Queue;
  public readonly backupDLQ: sqs.Queue;
  public readonly notificationQueue: sqs.Queue;
  public readonly notificationDLQ: sqs.Queue;
  public readonly restoreQueue: sqs.Queue;
  public readonly restoreDLQ: sqs.Queue;

  constructor(scope: Construct, id: string, props: QueueStackProps) {
    super(scope, id, props);

    const { config, encryptionKey } = props;

    // Backup Dead Letter Queue
    this.backupDLQ = new sqs.Queue(this, 'BackupDLQ', {
      queueName: `groundhog-${config.environment}-backup-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main Backup Queue
    this.backupQueue = new sqs.Queue(this, 'BackupQueue', {
      queueName: `groundhog-${config.environment}-backup`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      visibilityTimeout: cdk.Duration.minutes(5),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: this.backupDLQ,
        maxReceiveCount: 3,
      },
    });

    // Notification Dead Letter Queue
    this.notificationDLQ = new sqs.Queue(this, 'NotificationDLQ', {
      queueName: `groundhog-${config.environment}-notification-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      retentionPeriod: cdk.Duration.days(7),
    });

    // Notification Queue
    this.notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `groundhog-${config.environment}-notification`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: this.notificationDLQ,
        maxReceiveCount: 5,
      },
    });

    // Restore Dead Letter Queue
    this.restoreDLQ = new sqs.Queue(this, 'RestoreDLQ', {
      queueName: `groundhog-${config.environment}-restore-dlq`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      retentionPeriod: cdk.Duration.days(14),
    });

    // Restore Queue
    this.restoreQueue = new sqs.Queue(this, 'RestoreQueue', {
      queueName: `groundhog-${config.environment}-restore`,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: encryptionKey,
      visibilityTimeout: cdk.Duration.minutes(10),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: {
        queue: this.restoreDLQ,
        maxReceiveCount: 2,
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'BackupQueueUrl', {
      value: this.backupQueue.queueUrl,
      exportName: `groundhog-${config.environment}-backup-queue-url`,
    });

    new cdk.CfnOutput(this, 'BackupQueueArn', {
      value: this.backupQueue.queueArn,
      exportName: `groundhog-${config.environment}-backup-queue-arn`,
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: this.notificationQueue.queueUrl,
      exportName: `groundhog-${config.environment}-notification-queue-url`,
    });

    new cdk.CfnOutput(this, 'RestoreQueueUrl', {
      value: this.restoreQueue.queueUrl,
      exportName: `groundhog-${config.environment}-restore-queue-url`,
    });
  }
}
