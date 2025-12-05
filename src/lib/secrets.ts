import {
  SecretsManagerClient,
  GetSecretValueCommand,
  CreateSecretCommand,
  DeleteSecretCommand,
  UpdateSecretCommand,
} from '@aws-sdk/client-secrets-manager';

let secretsClient: SecretsManagerClient | null = null;

export function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    const endpoint = process.env['AWS_ENDPOINT'];
    secretsClient = new SecretsManagerClient({
      ...(endpoint ? { endpoint } : {}),
      region: process.env['AWS_REGION'] || 'us-east-2',
    });
  }
  return secretsClient;
}

export async function getSecret(secretId: string): Promise<string | null> {
  const client = getSecretsClient();
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretId })
    );
    return response.SecretString ?? null;
  } catch (error) {
    if ((error as Error).name === 'ResourceNotFoundException') {
      return null;
    }
    throw error;
  }
}

export async function createSecret(
  name: string,
  value: string,
  tags: Record<string, string> = {}
): Promise<string> {
  const client = getSecretsClient();
  const response = await client.send(
    new CreateSecretCommand({
      Name: name,
      SecretString: value,
      Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
    })
  );
  return response.ARN!;
}

export async function updateSecret(secretId: string, value: string): Promise<void> {
  const client = getSecretsClient();
  await client.send(
    new UpdateSecretCommand({
      SecretId: secretId,
      SecretString: value,
    })
  );
}

export async function deleteSecret(secretId: string): Promise<void> {
  const client = getSecretsClient();
  await client.send(
    new DeleteSecretCommand({
      SecretId: secretId,
      ForceDeleteWithoutRecovery: process.env['NODE_ENV'] !== 'production',
    })
  );
}

export function generateSecretName(orgId: string, apiKeyId: string): string {
  return `groundhog/${orgId}/${apiKeyId}`;
}
