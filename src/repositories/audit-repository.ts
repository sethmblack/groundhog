import { v4 as uuid } from 'uuid';
import {
  getDocClient,
  TABLE_NAME,
  PutCommand,
  QueryCommand,
} from '@/lib/dynamodb';
import { AuditLog, AuditEventType } from '@/types';

export interface CreateAuditLogInput {
  orgId: string;
  eventType: AuditEventType;
  userId?: string;
  userEmail?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditRepository {
  private docClient = getDocClient();
  private tableName = TABLE_NAME;

  async create(input: CreateAuditLogInput): Promise<AuditLog> {
    const now = new Date().toISOString();
    const eventId = uuid();

    const auditLog: AuditLog = {
      eventId,
      orgId: input.orgId,
      eventType: input.eventType,
      userId: input.userId,
      userEmail: input.userEmail,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      details: input.details,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      timestamp: now,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ORG#${input.orgId}`,
          SK: `AUDIT#${now}#${eventId}`,
          GSI1PK: `ORG#${input.orgId}#AUDIT`,
          GSI1SK: `${input.eventType}#${now}`,
          ...auditLog,
          entityType: 'AUDIT',
        },
      })
    );

    return auditLog;
  }

  async listByOrg(
    orgId: string,
    options: {
      limit?: number;
      startDate?: string;
      endDate?: string;
      eventType?: AuditEventType;
    } = {}
  ): Promise<AuditLog[]> {
    const { limit = 100, startDate, endDate, eventType } = options;

    let keyConditionExpression = 'PK = :pk AND begins_with(SK, :sk)';
    const expressionAttributeValues: Record<string, unknown> = {
      ':pk': `ORG#${orgId}`,
      ':sk': 'AUDIT#',
    };

    if (startDate) {
      keyConditionExpression += ' AND SK >= :startDate';
      expressionAttributeValues[':startDate'] = `AUDIT#${startDate}`;
    }

    if (endDate) {
      keyConditionExpression += ' AND SK <= :endDate';
      expressionAttributeValues[':endDate'] = `AUDIT#${endDate}`;
    }

    let filterExpression: string | undefined;
    if (eventType) {
      filterExpression = 'eventType = :eventType';
      expressionAttributeValues[':eventType'] = eventType;
    }

    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(filterExpression ? { FilterExpression: filterExpression } : {}),
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items || []).map((item) => this.mapToAuditLog(item));
  }

  async listByEventType(
    orgId: string,
    eventType: AuditEventType,
    limit: number = 100
  ): Promise<AuditLog[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}#AUDIT`,
          ':sk': `${eventType}#`,
        },
        ScanIndexForward: false,
        Limit: limit,
      })
    );

    return (result.Items || []).map((item) => this.mapToAuditLog(item));
  }

  private mapToAuditLog(item: Record<string, unknown>): AuditLog {
    return {
      eventId: item['eventId'] as string,
      orgId: item['orgId'] as string,
      eventType: item['eventType'] as AuditEventType,
      userId: item['userId'] as string | undefined,
      userEmail: item['userEmail'] as string | undefined,
      resourceType: item['resourceType'] as string | undefined,
      resourceId: item['resourceId'] as string | undefined,
      details: item['details'] as Record<string, unknown> | undefined,
      ipAddress: item['ipAddress'] as string | undefined,
      userAgent: item['userAgent'] as string | undefined,
      timestamp: item['timestamp'] as string,
    };
  }
}
