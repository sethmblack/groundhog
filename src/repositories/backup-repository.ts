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
    // Query by PK (orgId) with SK prefix for backups, then filter by snapshotId
    // This is needed because snapshotId is not part of the key structure
    // Must paginate through all DynamoDB results since filter happens after fetch
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          FilterExpression: 'snapshotId = :snapshotId',
          ExpressionAttributeValues: {
            ':pk': `ORG#${orgId}`,
            ':sk': 'BACKUP#',
            ':snapshotId': snapshotId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (result.Items && result.Items.length > 0) {
        return this.mapToBackup(result.Items[0]);
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return null;
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

  async listByOrgPaginated(
    orgId: string,
    page: number,
    limit: number
  ): Promise<{
    data: Backup[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    // Skip items for previous pages
    const skipCount = (page - 1) * limit;

    // Fetch items, skipping previous pages - fetch one extra to check if there's more
    const allItems: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;
    let skipped = 0;
    let hasMoreData = false;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `ORG#${orgId}`,
            ':sk': 'BACKUP#',
          },
          ScanIndexForward: false,
          Limit: limit + skipCount - skipped + 1, // +1 to check if there's more
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (result.Items) {
        for (const item of result.Items) {
          if (skipped < skipCount) {
            skipped++;
          } else if (allItems.length < limit) {
            allItems.push(item);
          } else {
            // We have one more item than we need - there's more data
            hasMoreData = true;
            break;
          }
        }
      }

      // Stop if we have enough items
      if (allItems.length >= limit) {
        // Check if there's more data after this page
        if (result.LastEvaluatedKey || hasMoreData) {
          hasMoreData = true;
        }
        break;
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey && allItems.length < limit);

    // Estimate total based on what we know (don't do expensive count query)
    const estimatedTotal = skipCount + allItems.length + (hasMoreData ? 1 : 0);

    return {
      data: allItems.map((item) => this.mapToBackup(item)),
      pagination: {
        page,
        limit,
        total: estimatedTotal, // This is a minimum, not exact
        totalPages: hasMoreData ? page + 1 : page, // At least one more page if hasMore
        hasNext: hasMoreData,
        hasPrev: page > 1,
      },
    };
  }

  async listByOrg(orgId: string, maxItems: number = 10000): Promise<Backup[]> {
    // Fetch all backups for the org, paginating through DynamoDB results
    const allItems: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `ORG#${orgId}`,
            ':sk': 'BACKUP#',
          },
          ScanIndexForward: false,
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (result.Items) {
        allItems.push(...result.Items);
      }

      // Stop if we've reached the max items limit
      if (allItems.length >= maxItems) {
        break;
      }

      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return allItems.slice(0, maxItems).map((item) => this.mapToBackup(item));
  }

  async getLatestByDashboard(
    orgId: string,
    dashboardGuid: string
  ): Promise<Backup | null> {
    const backups = await this.listByDashboard(orgId, dashboardGuid, 1);
    return backups[0] || null;
  }

  async countByOrg(orgId: string): Promise<number> {
    let totalCount = 0;
    let lastEvaluatedKey: Record<string, unknown> | undefined = undefined;

    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `ORG#${orgId}`,
            ':sk': 'BACKUP#',
          },
          Select: 'COUNT',
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      totalCount += result.Count || 0;
      lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastEvaluatedKey);

    return totalCount;
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
