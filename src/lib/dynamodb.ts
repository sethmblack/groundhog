import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  GetCommandInput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';

let dynamoClient: DynamoDBClient | null = null;
let docClient: DynamoDBDocumentClient | null = null;

export function getDynamoClient(): DynamoDBClient {
  if (!dynamoClient) {
    const endpoint = process.env['AWS_ENDPOINT'];
    dynamoClient = new DynamoDBClient({
      ...(endpoint ? { endpoint } : {}),
      region: process.env['AWS_REGION'] || 'us-east-2',
    });
  }
  return dynamoClient;
}

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(getDynamoClient(), {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: false,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }
  return docClient;
}

export const TABLE_NAME = process.env['DYNAMODB_TABLE'] || 'groundhog-dev';

// Re-export commands for convenience
export {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
};

export type {
  GetCommandInput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommandInput,
};
