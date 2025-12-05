import { v4 as uuid } from 'uuid';
import {
  getDocClient,
  TABLE_NAME,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@/lib/dynamodb';
import { Backup } from '@/types';
import { NotFoundError } from '@/lib/errors';

export interface CreateBackupInput {
  orgId: string;
  dashboardGuid: string;
  dashboardName: string;
  accountId: string;
  accountName: string;
  ownerEmail?: string;
  s3Key: string;
  s3Bucket: string;
  dashboardUpdatedAt?: string;
  sizeBytes: number;
  checksum: string;
}

export interface ListBackupsOptions {
  orgId: string;
  dashboardGuid?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export class BackupRepository {
  private docClient = getDocClient();
  private tableName = TABLE_NAME;

  async create(input: CreateBackupInput): Promise<Backup> {
    const now = new Date().toISOString();
    const snapshotId = uuid();

    const backup: Backup = {
      snapshotId,
      orgId: input.orgId,
      dashboardGuid: input.dashboardGuid,
      dashboardName: input.dashboardName,
      accountId: input.accountId,
      accountName: input.accountName,
      ownerEmail: input.ownerEmail,
      s3Key: input.s3Key,
      s3Bucket: input.s3Bucket,
      backupTimestamp: now,
      dashboardUpdatedAt: input.dashboardUpdatedAt,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ORG#${input.orgId}`,
          SK: `BACKUP#${input.dashboardGuid}#${now}`,
          GSI1PK: `ORG#${input.orgId}#DASHBOARD#${input.dashboardGuid}`,
          GSI1SK: `BACKUP#${now}`,
          GSI2PK: `ORG#${input.orgId}#ACCOUNT#${input.accountId}`,
          GSI2SK: `BACKUP#${now}`,
          ...backup,
          entityType: 'BACKUP',
        },
      })
    );

    return backup;
  }

  async findById(orgId: string, snapshotId: string): Promise<Backup | null> {
    // Query by snapshotId using GSI
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'begins_with(GSI1PK, :pk)',
        FilterExpression: 'snapshotId = :snapshotId',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':snapshotId': snapshotId,
        },
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return this.mapToBackup(result.Items[0]);
  }

  async listByDashboard(
    orgId: string,
    dashboardGuid: string,
    limit: number = 50
  ): Promise<Backup[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}#DASHBOARD#${dashboardGuid}`,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit,
      })
    );

    return (result.Items || []).map((item) => this.mapToBackup(item));
  }

  async listByAccount(
    orgId: string,
    accountId: string,
    limit: number = 100
  ): Promise<Backup[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}#ACCOUNT#${accountId}`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items || []).map((item) => this.mapToBackup(item));
  }

  async listByOrg(orgId: string, limit: number = 100): Promise<Backup[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':sk': 'BACKUP#',
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items || []).map((item) => this.mapToBackup(item));
  }

  async getLatestByDashboard(
    orgId: string,
    dashboardGuid: string
  ): Promise<Backup | null> {
    const backups = await this.listByDashboard(orgId, dashboardGuid, 1);
    return backups[0] || null;
  }

  async countByOrg(orgId: string): Promise<number> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':sk': 'BACKUP#',
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  }

  async getStorageUsage(orgId: string): Promise<number> {
    const backups = await this.listByOrg(orgId, 10000);
    return backups.reduce((total, backup) => total + backup.sizeBytes, 0);
  }

  private mapToBackup(item: Record<string, unknown>): Backup {
    return {
      snapshotId: item['snapshotId'] as string,
      orgId: item['orgId'] as string,
      dashboardGuid: item['dashboardGuid'] as string,
      dashboardName: item['dashboardName'] as string,
      accountId: item['accountId'] as string,
      accountName: item['accountName'] as string,
      ownerEmail: item['ownerEmail'] as string | undefined,
      s3Key: item['s3Key'] as string,
      s3Bucket: item['s3Bucket'] as string,
      backupTimestamp: item['backupTimestamp'] as string,
      dashboardUpdatedAt: item['dashboardUpdatedAt'] as string | undefined,
      sizeBytes: item['sizeBytes'] as number,
      checksum: item['checksum'] as string,
    };
  }
}
