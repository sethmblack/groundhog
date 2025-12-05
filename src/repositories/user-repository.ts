import { v4 as uuid } from 'uuid';
import {
  getDocClient,
  TABLE_NAME,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@/lib/dynamodb';
import { User, UserStatus, OrgMembership, Role } from '@/types';
import { NotFoundError, ConflictError } from '@/lib/errors';

export interface CreateUserInput {
  email: string;
  fullName?: string;
  cognitoSub: string;
}

export interface UpdateUserInput {
  fullName?: string;
  status?: UserStatus;
}

export class UserRepository {
  private docClient = getDocClient();
  private tableName = TABLE_NAME;

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const userId = input.cognitoSub; // Use Cognito sub as userId

    // Check if user already exists by email
    const existingUser = await this.findByEmail(input.email);
    if (existingUser) {
      throw new ConflictError('User with this email already exists');
    }

    const user: User = {
      userId,
      email: input.email,
      fullName: input.fullName,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `USER#${userId}`,
          SK: `USER#${userId}`,
          GSI1PK: `USER#EMAIL`,
          GSI1SK: input.email.toLowerCase(),
          ...user,
          entityType: 'USER',
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );

    return user;
  }

  async findById(userId: string): Promise<User | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: `USER#${userId}`,
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    return this.mapToUser(result.Item);
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
        ExpressionAttributeValues: {
          ':pk': 'USER#EMAIL',
          ':sk': email.toLowerCase(),
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return this.mapToUser(result.Items[0]);
  }

  async update(userId: string, input: UpdateUserInput): Promise<User> {
    const updateExpressions: string[] = ['#updatedAt = :updatedAt'];
    const expressionAttributeNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
    };
    const expressionAttributeValues: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };

    if (input.fullName !== undefined) {
      updateExpressions.push('#fullName = :fullName');
      expressionAttributeNames['#fullName'] = 'fullName';
      expressionAttributeValues[':fullName'] = input.fullName;
    }

    if (input.status !== undefined) {
      updateExpressions.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = input.status;
    }

    const result = await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: {
          PK: `USER#${userId}`,
          SK: `USER#${userId}`,
        },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!result.Attributes) {
      throw new NotFoundError('User not found');
    }

    return this.mapToUser(result.Attributes);
  }

  async getOrganizations(userId: string): Promise<OrgMembership[]> {
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': 'ORG#',
        },
      })
    );

    return (result.Items || []).map((item) => ({
      userId,
      orgId: item['orgId'] as string,
      role: item['role'] as Role,
      joinedAt: item['joinedAt'] as string,
      invitedBy: item['invitedBy'] as string | undefined,
    }));
  }

  private mapToUser(item: Record<string, unknown>): User {
    return {
      userId: item['userId'] as string,
      email: item['email'] as string,
      fullName: item['fullName'] as string | undefined,
      status: item['status'] as UserStatus,
      createdAt: item['createdAt'] as string,
      updatedAt: item['updatedAt'] as string,
    };
  }
}
