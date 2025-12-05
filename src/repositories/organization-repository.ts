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
import {
  Organization,
  OrgStatus,
  SubscriptionTier,
  OrgMembership,
  Role,
} from '@/types';
import { NotFoundError, ConflictError } from '@/lib/errors';

export interface CreateOrganizationInput {
  name: string;
  createdBy: string;
  subscriptionTier?: SubscriptionTier;
}

export interface UpdateOrganizationInput {
  name?: string;
  status?: OrgStatus;
  subscriptionTier?: SubscriptionTier;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  settings?: Record<string, unknown>;
}

export interface AddMemberInput {
  userId: string;
  orgId: string;
  role: Role;
  invitedBy?: string;
}

export class OrganizationRepository {
  private docClient = getDocClient();
  private tableName = TABLE_NAME;

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const now = new Date().toISOString();
    const orgId = uuid();

    const organization: Organization = {
      orgId,
      name: input.name,
      status: 'ACTIVE',
      subscriptionTier: input.subscriptionTier || 'FREE',
      createdAt: now,
      createdBy: input.createdBy,
      updatedAt: now,
    };

    // Create organization record
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ORG#${orgId}`,
          SK: `ORG#${orgId}`,
          GSI1PK: 'ORG',
          GSI1SK: `STATUS#${organization.status}#${now}`,
          ...organization,
          entityType: 'ORGANIZATION',
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    // Add creator as ADMIN
    await this.addMember({
      userId: input.createdBy,
      orgId,
      role: 'ADMIN',
    });

    return organization;
  }

  async findById(orgId: string): Promise<Organization | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `ORG#${orgId}`,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return this.mapToOrganization(result.Item);
  }

  async update(orgId: string, input: UpdateOrganizationInput): Promise<Organization> {
    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };

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

    if (input.subscriptionTier !== undefined) {
      updateExpressions.push('#subscriptionTier = :subscriptionTier');
      expressionAttributeNames['#subscriptionTier'] = 'subscriptionTier';
      expressionAttributeValues[':subscriptionTier'] = input.subscriptionTier;
    }

    if (input.stripeCustomerId !== undefined) {
      updateExpressions.push('#stripeCustomerId = :stripeCustomerId');
      expressionAttributeNames['#stripeCustomerId'] = 'stripeCustomerId';
      expressionAttributeValues[':stripeCustomerId'] = input.stripeCustomerId;
    }

    if (input.stripeSubscriptionId !== undefined) {
      updateExpressions.push('#stripeSubscriptionId = :stripeSubscriptionId');
      expressionAttributeNames['#stripeSubscriptionId'] = 'stripeSubscriptionId';
      expressionAttributeValues[':stripeSubscriptionId'] = input.stripeSubscriptionId;
    }

    if (input.settings !== undefined) {
      updateExpressions.push('#settings = :settings');
      expressionAttributeNames['#settings'] = 'settings';
      expressionAttributeValues[':settings'] = input.settings;
    }

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `ORG#${orgId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!result.Attributes) {
      throw new NotFoundError('Organization not found');
    }

    return this.mapToOrganization(result.Attributes);
  }

  async delete(orgId: string): Promise<void> {
    // First check if org exists
    const org = await this.findById(orgId);
    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    // Delete the organization record
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `ORG#${orgId}`,
          SK: `ORG#${orgId}`,
        },
      })
    );

    // Note: In production, we'd also delete all members, API keys, etc.
    // This would be done with BatchWrite or a separate cleanup process
  }

  async addMember(input: AddMemberInput): Promise<OrgMembership> {
    const now = new Date().toISOString();

    const membership: OrgMembership = {
      userId: input.userId,
      orgId: input.orgId,
      role: input.role,
      joinedAt: now,
      invitedBy: input.invitedBy,
    };

    // Store membership on user record (for user -> orgs lookup)
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${input.userId}`,
          SK: `ORG#${input.orgId}`,
          GSI1PK: `ORG#${input.orgId}`,
          GSI1SK: `MEMBER#${input.role}#${input.userId}`,
          ...membership,
          entityType: 'MEMBERSHIP',
        },
      })
    );

    return membership;
  }

  async removeMember(userId: string, orgId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: `ORG#${orgId}`,
        },
      })
    );
  }

  async updateMemberRole(
    userId: string,
    orgId: string,
    newRole: Role
  ): Promise<OrgMembership> {
    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: `ORG#${orgId}`,
        },
        UpdateExpression: 'SET #role = :role, GSI1SK = :gsi1sk',
        ExpressionAttributeNames: {
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':role': newRole,
          ':gsi1sk': `MEMBER#${newRole}#${userId}`,
        },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!result.Attributes) {
      throw new NotFoundError('Membership not found');
    }

    return {
      userId: result.Attributes['userId'] as string,
      orgId: result.Attributes['orgId'] as string,
      role: result.Attributes['role'] as Role,
      joinedAt: result.Attributes['joinedAt'] as string,
      invitedBy: result.Attributes['invitedBy'] as string | undefined,
    };
  }

  async getMembers(orgId: string): Promise<OrgMembership[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ORG#${orgId}`,
          ':sk': 'MEMBER#',
        },
      })
    );

    return (result.Items || []).map((item) => ({
      userId: item['userId'] as string,
      orgId: item['orgId'] as string,
      role: item['role'] as Role,
      joinedAt: item['joinedAt'] as string,
      invitedBy: item['invitedBy'] as string | undefined,
    }));
  }

  async getMembership(userId: string, orgId: string): Promise<OrgMembership | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: `ORG#${orgId}`,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return {
      userId: result.Item['userId'] as string,
      orgId: result.Item['orgId'] as string,
      role: result.Item['role'] as Role,
      joinedAt: result.Item['joinedAt'] as string,
      invitedBy: result.Item['invitedBy'] as string | undefined,
    };
  }

  async listByUser(userId: string): Promise<Organization[]> {
    // First get user's memberships
    const memberships = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'ORG#',
        },
      })
    );

    if (!memberships.Items || memberships.Items.length === 0) {
      return [];
    }

    // Then fetch each organization
    const orgs: Organization[] = [];
    for (const item of memberships.Items) {
      const orgId = item['orgId'] as string;
      const org = await this.findById(orgId);
      if (org) {
        orgs.push(org);
      }
    }

    return orgs;
  }

  private mapToOrganization(item: Record<string, unknown>): Organization {
    return {
      orgId: item['orgId'] as string,
      name: item['name'] as string,
      status: item['status'] as OrgStatus,
      subscriptionTier: item['subscriptionTier'] as SubscriptionTier,
      stripeCustomerId: item['stripeCustomerId'] as string | undefined,
      stripeSubscriptionId: item['stripeSubscriptionId'] as string | undefined,
      createdAt: item['createdAt'] as string,
      createdBy: item['createdBy'] as string,
      updatedAt: item['updatedAt'] as string,
      settings: item['settings'] as Record<string, unknown> | undefined,
    };
  }
}
