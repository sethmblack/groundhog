import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ApiKeyService } from '@/services/apikey-service';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { NotFoundError, BadRequestError, ForbiddenError } from '@/lib/errors';

// Mock dependencies
vi.mock('@/repositories/apikey-repository');
vi.mock('@/lib/secrets', () => ({
  createSecret: vi.fn().mockResolvedValue('arn:aws:secretsmanager:us-east-2:123456789:secret:test'),
  updateSecret: vi.fn().mockResolvedValue(undefined),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  getSecret: vi.fn().mockResolvedValue(JSON.stringify({ apiKey: 'NRAK-test123' })),
  generateSecretName: vi.fn().mockReturnValue('groundhog/org-123/key-456'),
}));

vi.mock('@/clients/newrelic', () => ({
  NewRelicClient: vi.fn().mockImplementation(() => ({
    validateApiKey: vi.fn().mockResolvedValue({
      valid: true,
      accounts: [
        { id: '12345', name: 'Test Account' },
        { id: '67890', name: 'Another Account' },
      ],
    }),
  })),
}));

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let mockApiKeyRepo: { [key: string]: Mock };

  beforeEach(() => {
    vi.clearAllMocks();

    mockApiKeyRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      findByIdGlobal: vi.fn(),
      listByOrg: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      countByOrg: vi.fn(),
    };

    (ApiKeyRepository as Mock).mockImplementation(() => mockApiKeyRepo);

    service = new ApiKeyService(mockApiKeyRepo as unknown as ApiKeyRepository);
  });

  describe('create', () => {
    it('should create an API key', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        name: 'Test Key',
        secretArn: 'arn:aws:secretsmanager:us-east-2:123456789:secret:test',
        newRelicAccountIds: ['12345', '67890'],
        status: 'ACTIVE',
        dashboardCount: 0,
        createdAt: new Date().toISOString(),
        createdBy: 'user-123',
      };

      mockApiKeyRepo.countByOrg.mockResolvedValue(0);
      mockApiKeyRepo.create.mockResolvedValue(mockApiKey);
      mockApiKeyRepo.update.mockResolvedValue(mockApiKey);

      const result = await service.create({
        orgId: 'org-123',
        name: 'Test Key',
        newRelicApiKey: 'NRAK-test123',
        createdBy: 'user-123',
      });

      expect(result.apiKeyId).toBe('key-123');
      expect(result.orgId).toBe('org-123');
      expect(mockApiKeyRepo.create).toHaveBeenCalled();
    });

    it('should enforce tier limits', async () => {
      mockApiKeyRepo.countByOrg.mockResolvedValue(1);

      await expect(
        service.create({
          orgId: 'org-123',
          name: 'Test Key',
          newRelicApiKey: 'NRAK-test123',
          createdBy: 'user-123',
        }, 'FREE')
      ).rejects.toThrow(ForbiddenError);
    });

    it('should allow more keys for PRO tier', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        name: 'Test Key',
        secretArn: 'arn:aws:secretsmanager:us-east-2:123456789:secret:test',
        newRelicAccountIds: ['12345', '67890'],
        status: 'ACTIVE',
        dashboardCount: 0,
        createdAt: new Date().toISOString(),
        createdBy: 'user-123',
      };

      mockApiKeyRepo.countByOrg.mockResolvedValue(1); // 1 existing key
      mockApiKeyRepo.create.mockResolvedValue(mockApiKey);
      mockApiKeyRepo.update.mockResolvedValue(mockApiKey);

      // PRO tier allows 5 keys
      const result = await service.create({
        orgId: 'org-123',
        name: 'Test Key',
        newRelicApiKey: 'NRAK-test123',
        createdBy: 'user-123',
      }, 'PRO');

      expect(result).toBeDefined();
    });
  });

  describe('getById', () => {
    it('should return API key if found', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        name: 'Test Key',
      };

      mockApiKeyRepo.findById.mockResolvedValue(mockApiKey);

      const result = await service.getById('org-123', 'key-123');

      expect(result).toEqual(mockApiKey);
    });

    it('should throw NotFoundError if not found', async () => {
      mockApiKeyRepo.findById.mockResolvedValue(null);

      await expect(service.getById('org-123', 'nonexistent')).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('list', () => {
    it('should return paginated API keys', async () => {
      const mockApiKeys = [
        { apiKeyId: 'key-1', name: 'Key 1' },
        { apiKeyId: 'key-2', name: 'Key 2' },
      ];

      mockApiKeyRepo.listByOrg.mockResolvedValue(mockApiKeys);

      const result = await service.list('org-123', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });
  });

  describe('update', () => {
    it('should update API key name', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        name: 'Old Name',
        secretArn: 'arn:aws:...',
        status: 'ACTIVE',
      };

      const updatedApiKey = { ...mockApiKey, name: 'New Name' };

      mockApiKeyRepo.findById.mockResolvedValue(mockApiKey);
      mockApiKeyRepo.update.mockResolvedValue(updatedApiKey);

      const result = await service.update('org-123', 'key-123', { name: 'New Name' });

      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundError if API key not found', async () => {
      mockApiKeyRepo.findById.mockResolvedValue(null);

      await expect(
        service.update('org-123', 'nonexistent', { name: 'New Name' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('should delete API key', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        secretArn: 'arn:aws:...',
      };

      mockApiKeyRepo.findById.mockResolvedValue(mockApiKey);
      mockApiKeyRepo.delete.mockResolvedValue(undefined);

      await expect(service.delete('org-123', 'key-123')).resolves.not.toThrow();
      expect(mockApiKeyRepo.delete).toHaveBeenCalledWith('org-123', 'key-123');
    });

    it('should throw NotFoundError if API key not found', async () => {
      mockApiKeyRepo.findById.mockResolvedValue(null);

      await expect(service.delete('org-123', 'nonexistent')).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('validate', () => {
    it('should validate API key and update status', async () => {
      const mockApiKey = {
        apiKeyId: 'key-123',
        orgId: 'org-123',
        secretArn: 'arn:aws:...',
        newRelicAccountIds: ['12345'],
        status: 'ACTIVE',
      };

      mockApiKeyRepo.findById.mockResolvedValue(mockApiKey);
      mockApiKeyRepo.update.mockResolvedValue({ ...mockApiKey, status: 'ACTIVE' });

      const result = await service.validate('org-123', 'key-123');

      expect(result.valid).toBe(true);
      expect(result.accounts).toHaveLength(2);
      expect(mockApiKeyRepo.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError if API key not found', async () => {
      mockApiKeyRepo.findById.mockResolvedValue(null);

      await expect(service.validate('org-123', 'nonexistent')).rejects.toThrow(
        NotFoundError
      );
    });
  });
});
