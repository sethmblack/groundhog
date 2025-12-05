import { ApiKeyRepository, CreateApiKeyInput } from '@/repositories/apikey-repository';
import {
  createSecret,
  updateSecret,
  deleteSecret,
  getSecret,
  generateSecretName,
} from '@/lib/secrets';
import { NewRelicClient } from '@/clients/newrelic';
import { ApiKey, PaginatedResponse, Pagination } from '@/types';
import { NotFoundError, BadRequestError, ForbiddenError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface CreateApiKeyServiceInput {
  orgId: string;
  name: string;
  newRelicApiKey: string;
  createdBy: string;
}

export interface UpdateApiKeyServiceInput {
  name?: string;
  newRelicApiKey?: string;
}

export interface ValidateApiKeyResult {
  valid: boolean;
  accounts: Array<{ id: string; name: string }>;
}

// Tier limits
const API_KEY_LIMITS: Record<string, number> = {
  FREE: 1,
  PRO: 5,
  ENTERPRISE: 25,
};

export class ApiKeyService {
  private apiKeyRepository: ApiKeyRepository;

  constructor(apiKeyRepository?: ApiKeyRepository) {
    this.apiKeyRepository = apiKeyRepository || new ApiKeyRepository();
  }

  async create(
    input: CreateApiKeyServiceInput,
    subscriptionTier: string = 'FREE'
  ): Promise<ApiKey> {
    // Check tier limits
    const currentCount = await this.apiKeyRepository.countByOrg(input.orgId);
    const limit = API_KEY_LIMITS[subscriptionTier] || 1;

    if (currentCount >= limit) {
      throw new ForbiddenError(
        `API key limit reached for ${subscriptionTier} tier (${limit} keys)`
      );
    }

    // Validate the New Relic API key first
    const client = new NewRelicClient(input.newRelicApiKey);
    const validation = await client.validateApiKey();

    if (!validation.valid) {
      throw new BadRequestError('Invalid New Relic API key');
    }

    if (validation.accounts.length === 0) {
      throw new BadRequestError('No accounts accessible with this API key');
    }

    // Store the API key in Secrets Manager
    const secretName = generateSecretName(input.orgId, 'pending');
    const secretArn = await createSecret(
      secretName,
      JSON.stringify({ apiKey: input.newRelicApiKey }),
      {
        orgId: input.orgId,
        service: 'groundhog',
      }
    );

    // Create the API key record
    const apiKey = await this.apiKeyRepository.create({
      orgId: input.orgId,
      name: input.name,
      secretArn,
      newRelicAccountIds: validation.accounts.map((a) => a.id),
      createdBy: input.createdBy,
    });

    // Update secret name with actual API key ID
    const newSecretName = generateSecretName(input.orgId, apiKey.apiKeyId);
    // Note: In production, we'd rename the secret or create with the correct name

    // Update with validation timestamp
    await this.apiKeyRepository.update(input.orgId, apiKey.apiKeyId, {
      lastValidated: new Date().toISOString(),
    });

    logger.info(
      {
        orgId: input.orgId,
        apiKeyId: apiKey.apiKeyId,
        accountCount: validation.accounts.length,
      },
      'API key created'
    );

    return apiKey;
  }

  async getById(orgId: string, apiKeyId: string): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }
    return apiKey;
  }

  async list(orgId: string, pagination: Pagination): Promise<PaginatedResponse<ApiKey>> {
    const apiKeys = await this.apiKeyRepository.listByOrg(orgId);

    // Simple in-memory pagination
    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const paginatedKeys = apiKeys.slice(start, end);

    return {
      data: paginatedKeys,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: apiKeys.length,
        totalPages: Math.ceil(apiKeys.length / pagination.limit),
        hasNext: end < apiKeys.length,
        hasPrev: pagination.page > 1,
      },
    };
  }

  async update(
    orgId: string,
    apiKeyId: string,
    input: UpdateApiKeyServiceInput
  ): Promise<ApiKey> {
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    const updates: Record<string, unknown> = {};

    if (input.name !== undefined) {
      updates['name'] = input.name;
    }

    if (input.newRelicApiKey !== undefined) {
      // Validate the new key
      const client = new NewRelicClient(input.newRelicApiKey);
      const validation = await client.validateApiKey();

      if (!validation.valid) {
        throw new BadRequestError('Invalid New Relic API key');
      }

      // Update the secret
      await updateSecret(
        apiKey.secretArn,
        JSON.stringify({ apiKey: input.newRelicApiKey })
      );

      updates['newRelicAccountIds'] = validation.accounts.map((a) => a.id);
      updates['lastValidated'] = new Date().toISOString();
      updates['status'] = 'ACTIVE';
    }

    const updated = await this.apiKeyRepository.update(orgId, apiKeyId, updates);

    logger.info({ orgId, apiKeyId }, 'API key updated');

    return updated;
  }

  async delete(orgId: string, apiKeyId: string): Promise<void> {
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    // Delete from Secrets Manager
    try {
      await deleteSecret(apiKey.secretArn);
    } catch (error) {
      logger.warn({ error, secretArn: apiKey.secretArn }, 'Failed to delete secret');
      // Continue with API key deletion even if secret deletion fails
    }

    // Delete from DynamoDB
    await this.apiKeyRepository.delete(orgId, apiKeyId);

    logger.info({ orgId, apiKeyId }, 'API key deleted');
  }

  async validate(orgId: string, apiKeyId: string): Promise<ValidateApiKeyResult> {
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    // Get the actual key from Secrets Manager
    const secretValue = await getSecret(apiKey.secretArn);
    if (!secretValue) {
      await this.apiKeyRepository.update(orgId, apiKeyId, { status: 'INVALID' });
      return { valid: false, accounts: [] };
    }

    const { apiKey: newRelicApiKey } = JSON.parse(secretValue) as { apiKey: string };

    // Validate with New Relic
    const client = new NewRelicClient(newRelicApiKey);
    const validation = await client.validateApiKey();

    // Update status based on validation
    await this.apiKeyRepository.update(orgId, apiKeyId, {
      status: validation.valid ? 'ACTIVE' : 'INVALID',
      lastValidated: new Date().toISOString(),
      newRelicAccountIds: validation.valid
        ? validation.accounts.map((a) => a.id)
        : apiKey.newRelicAccountIds,
    });

    logger.info(
      { orgId, apiKeyId, valid: validation.valid },
      'API key validated'
    );

    return validation;
  }

  async getNewRelicClient(orgId: string, apiKeyId: string): Promise<NewRelicClient> {
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    if (apiKey.status !== 'ACTIVE') {
      throw new BadRequestError('API key is not active');
    }

    const secretValue = await getSecret(apiKey.secretArn);
    if (!secretValue) {
      throw new BadRequestError('API key secret not found');
    }

    const { apiKey: newRelicApiKey } = JSON.parse(secretValue) as { apiKey: string };

    return new NewRelicClient(newRelicApiKey, apiKey.newRelicAccountIds);
  }
}
