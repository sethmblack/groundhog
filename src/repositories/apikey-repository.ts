import { v4 as uuid } from 'uuid';
import {
  getDocClient,
  TABLE_NAME,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@/lib/dynamodb';
import { ApiKey, ApiKeyStatus } from '@/types';
import { NotFoundError, ConflictError } from '@/lib/errors';

export interface CreateApiKeyInput {
  orgId: string;
  name: string;
  secretArn: string;
  newRelicAccountIds: string[];
  createdBy: string;
}

export interface UpdateApiKeyInput {
  name?: string;
  status?: ApiKeyStatus;
  newRelicAccountIds?: string[];
  lastValidated?: string;
  lastBackupRun?: string;
  dashboardCount?: number;
}

export class ApiKeyRepository {
  private docClient = getDocClient();
  private tableName = TABLE_NAME;

  async create(input: CreateApiKeyInput): Promise<ApiKey> {
    const now = new Date().toISOString();
    const apiKeyId = uuid();

    const apiKey: ApiKey = {
      apiKeyId,
      orgId: input.orgId,
      name: input.name,
      secretArn: input.secretArn,
      newRelicAccountIds: input.newRelicAccountIds,
      status: 'ACTIVE',
      dashboardCount: 0,
      createdAt: now,
      createdBy: input.createdBy,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ORG#${input.orgId}`,
          SK: `APIKEY#${apiKeyId}`,
          GSI1PK: `APIKEY#${apiKeyId}`,
          GSI1SK: `APIKEY#${apiKeyId}`,
          ...apiKey,
          entityType: 'APIKEY',
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    return apiKey;
  }

  async findById(orgId: string, apiKeyId: string): Promise<ApiKey | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `APIKEY#${apiKeyId}`,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return this.mapToApiKey(result.Item);
  }

  async findByIdGlobal(apiKeyId: string): Promise<ApiKey | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: {
          ':pk': `APIKEY#${apiKeyId}`,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return this.mapToApiKey(result.Items[0]);
  }

  async listByOrg(orgId: string): Promise<ApiKey[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':sk': 'APIKEY#',
        },
      })
    );

    return (result.Items || []).map((item) => this.mapToApiKey(item));
  }

  async update(orgId: string, apiKeyId: string, input: UpdateApiKeyInput): Promise<ApiKey> {
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, unknown> = {};

    if (input.name !== undefined) {
      updateExpressions.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = input.name;
    }

    if (input.status !== undefined) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = input.status;
    }

    if (input.newRelicAccountIds !== undefined) {
      updateExpressions.push('#newRelicAccountIds = :newRelicAccountIds');
      expressionAttributeNames['#newRelicAccountIds'] = 'newRelicAccountIds';
      expressionAttributeValues[':newRelicAccountIds'] = input.newRelicAccountIds;
    }

    if (input.lastValidated !== undefined) {
      updateExpressions.push('#lastValidated = :lastValidated');
      expressionAttributeNames['#lastValidated'] = 'lastValidated';
      expressionAttributeValues[':lastValidated'] = input.lastValidated;
    }

    if (input.lastBackupRun !== undefined) {
      updateExpressions.push('#lastBackupRun = :lastBackupRun');
      expressionAttributeNames['#lastBackupRun'] = 'lastBackupRun';
      expressionAttributeValues[':lastBackupRun'] = input.lastBackupRun;
    }

    if (input.dashboardCount !== undefined) {
      updateExpressions.push('#dashboardCount = :dashboardCount');
      expressionAttributeNames['#dashboardCount'] = 'dashboardCount';
      expressionAttributeValues[':dashboardCount'] = input.dashboardCount;
    }

    if (updateExpressions.length === 0) {
      const existing = await this.findById(orgId, apiKeyId);
      if (!existing) {
        throw new NotFoundError('API key not found');
      }
      return existing;
    }

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `APIKEY#${apiKeyId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!result.Attributes) {
      throw new NotFoundError('API key not found');
    }

    return this.mapToApiKey(result.Attributes);
  }

  async delete(orgId: string, apiKeyId: string): Promise<void> {
    const existing = await this.findById(orgId, apiKeyId);
    if (!existing) {
      throw new NotFoundError('API key not found');
    }

    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `APIKEY#${apiKeyId}`,
        },
      })
    );
  }

  async countByOrg(orgId: string): Promise<number> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':sk': 'APIKEY#',
        },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  }

  private mapToApiKey(item: Record<string, unknown>): ApiKey {
    return {
      apiKeyId: item['apiKeyId'] as string,
      orgId: item['orgId'] as string,
      name: item['name'] as string,
      secretArn: item['secretArn'] as string,
      newRelicAccountIds: item['newRelicAccountIds'] as string[],
      status: item['status'] as ApiKeyStatus,
      lastValidated: item['lastValidated'] as string | undefined,
      lastBackupRun: item['lastBackupRun'] as string | undefined,
      dashboardCount: item['dashboardCount'] as number,
      createdAt: item['createdAt'] as string,
      createdBy: item['createdBy'] as string,
    };
  }
}
