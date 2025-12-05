import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { BackupService } from '@/services/backup-service';
import { BackupRepository } from '@/repositories/backup-repository';
import { ApiKeyService } from '@/services/apikey-service';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { NotFoundError } from '@/lib/errors';

// Mock dependencies
vi.mock('@/repositories/backup-repository');
vi.mock('@/repositories/apikey-repository');
vi.mock('@/services/apikey-service');
vi.mock('@/lib/s3', () => ({
  putObject: vi.fn().mockResolvedValue(undefined),
  getObject: vi.fn().mockResolvedValue('{"name": "Test Dashboard"}'),
  BACKUP_BUCKET: 'test-bucket',
  generateBackupKey: vi.fn().mockReturnValue('org-123/account-456/dashboard-789/2024-01-01.json'),
}));

describe('BackupService', () => {
  let service: BackupService;
  let mockBackupRepo: { [key: string]: Mock };
  let mockApiKeyRepo: { [key: string]: Mock };
  let mockApiKeyService: { [key: string]: Mock };

  const mockNrClient = {
    getDashboardJson: vi.fn(),
    listDashboards: vi.fn(),
    getDashboard: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockBackupRepo = {
      create: vi.fn(),
      findById: vi.fn(),
      listByDashboard: vi.fn(),
      listByOrg: vi.fn(),
      listByAccount: vi.fn(),
      countByOrg: vi.fn(),
      getLatestByDashboard: vi.fn(),
    };

    mockApiKeyRepo = {
      findById: vi.fn(),
      update: vi.fn(),
    };

    mockApiKeyService = {
      getNewRelicClient: vi.fn().mockResolvedValue(mockNrClient),
    };

    (BackupRepository as Mock).mockImplementation(() => mockBackupRepo);
    (ApiKeyRepository as Mock).mockImplementation(() => mockApiKeyRepo);
    (ApiKeyService as Mock).mockImplementation(() => mockApiKeyService);

    service = new BackupService(
      mockBackupRepo as unknown as BackupRepository,
      mockApiKeyService as unknown as ApiKeyService,
      mockApiKeyRepo as unknown as ApiKeyRepository
    );
  });

  describe('backupDashboard', () => {
    it('should backup a dashboard successfully', async () => {
      const mockDashboardJson = JSON.stringify({
        guid: 'dashboard-123',
        name: 'Test Dashboard',
        accountId: 12345,
        owner: { email: 'owner@example.com' },
        updatedAt: '2024-01-01T00:00:00Z',
      });

      const mockBackup = {
        snapshotId: 'snapshot-123',
        orgId: 'org-123',
        dashboardGuid: 'dashboard-123',
        dashboardName: 'Test Dashboard',
        accountId: '12345',
        accountName: '',
        s3Key: 'org-123/12345/dashboard-123/2024-01-01.json',
        s3Bucket: 'test-bucket',
        backupTimestamp: new Date().toISOString(),
        sizeBytes: 150,
        checksum: 'abc123',
      };

      mockNrClient.getDashboardJson.mockResolvedValue(mockDashboardJson);
      mockBackupRepo.create.mockResolvedValue(mockBackup);
      mockBackupRepo.countByOrg.mockResolvedValue(5);
      mockApiKeyRepo.update.mockResolvedValue({});

      const result = await service.backupDashboard({
        orgId: 'org-123',
        apiKeyId: 'key-456',
        dashboardGuid: 'dashboard-123',
      });

      expect(result.snapshotId).toBe('snapshot-123');
      expect(result.dashboardName).toBe('Test Dashboard');
      expect(mockBackupRepo.create).toHaveBeenCalled();
    });

    it('should throw NotFoundError if dashboard not found', async () => {
      mockNrClient.getDashboardJson.mockResolvedValue(null);

      await expect(
        service.backupDashboard({
          orgId: 'org-123',
          apiKeyId: 'key-456',
          dashboardGuid: 'nonexistent',
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getBackup', () => {
    it('should return backup if found', async () => {
      const mockBackup = {
        snapshotId: 'snapshot-123',
        orgId: 'org-123',
        dashboardGuid: 'dashboard-123',
      };

      mockBackupRepo.findById.mockResolvedValue(mockBackup);

      const result = await service.getBackup('org-123', 'snapshot-123');

      expect(result).toEqual(mockBackup);
    });

    it('should throw NotFoundError if not found', async () => {
      mockBackupRepo.findById.mockResolvedValue(null);

      await expect(
        service.getBackup('org-123', 'nonexistent')
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getBackupContent', () => {
    it('should return backup content', async () => {
      const mockBackup = {
        snapshotId: 'snapshot-123',
        orgId: 'org-123',
        s3Bucket: 'test-bucket',
        s3Key: 'path/to/backup.json',
      };

      mockBackupRepo.findById.mockResolvedValue(mockBackup);

      const content = await service.getBackupContent('org-123', 'snapshot-123');

      expect(content).toBe('{"name": "Test Dashboard"}');
    });
  });

  describe('listBackupsByDashboard', () => {
    it('should return paginated backups', async () => {
      const mockBackups = [
        { snapshotId: 'snap-1', dashboardGuid: 'dash-123' },
        { snapshotId: 'snap-2', dashboardGuid: 'dash-123' },
      ];

      mockBackupRepo.listByDashboard.mockResolvedValue(mockBackups);

      const result = await service.listBackupsByDashboard(
        'org-123',
        'dash-123',
        { page: 1, limit: 10 }
      );

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });
  });

  describe('listBackupsByOrg', () => {
    it('should return paginated backups for org', async () => {
      const mockBackups = [
        { snapshotId: 'snap-1', dashboardGuid: 'dash-1' },
        { snapshotId: 'snap-2', dashboardGuid: 'dash-2' },
        { snapshotId: 'snap-3', dashboardGuid: 'dash-3' },
      ];

      mockBackupRepo.listByOrg.mockResolvedValue(mockBackups);

      const result = await service.listBackupsByOrg('org-123', { page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.pagination.total).toBe(3);
      expect(result.pagination.hasNext).toBe(true);
    });
  });

  describe('getStorageStats', () => {
    it('should return storage statistics', async () => {
      const mockBackups = [
        { snapshotId: 'snap-1', sizeBytes: 1000, backupTimestamp: '2024-01-01' },
        { snapshotId: 'snap-2', sizeBytes: 2000, backupTimestamp: '2024-01-02' },
        { snapshotId: 'snap-3', sizeBytes: 1500, backupTimestamp: '2024-01-03' },
      ];

      mockBackupRepo.listByOrg.mockResolvedValue(mockBackups);

      const stats = await service.getStorageStats('org-123');

      expect(stats.totalBackups).toBe(3);
      expect(stats.totalSizeBytes).toBe(4500);
      expect(stats.oldestBackup).toBe('2024-01-01');
      expect(stats.newestBackup).toBe('2024-01-03');
    });

    it('should handle empty backups', async () => {
      mockBackupRepo.listByOrg.mockResolvedValue([]);

      const stats = await service.getStorageStats('org-123');

      expect(stats.totalBackups).toBe(0);
      expect(stats.totalSizeBytes).toBe(0);
      expect(stats.oldestBackup).toBeUndefined();
    });
  });

  describe('backupAllDashboards', () => {
    it('should backup all dashboards for an account', async () => {
      const mockApiKey = {
        apiKeyId: 'key-456',
        orgId: 'org-123',
        newRelicAccountIds: ['12345'],
      };

      const mockDashboards = [
        { guid: 'dash-1', name: 'Dashboard 1', accountId: 12345 },
        { guid: 'dash-2', name: 'Dashboard 2', accountId: 12345 },
      ];

      const mockBackup = {
        snapshotId: 'snap-1',
        dashboardName: 'Dashboard',
        sizeBytes: 100,
        backupTimestamp: new Date().toISOString(),
      };

      mockApiKeyRepo.findById.mockResolvedValue(mockApiKey);
      mockNrClient.listDashboards.mockResolvedValue(mockDashboards);
      mockNrClient.getDashboardJson.mockResolvedValue(
        JSON.stringify({ name: 'Test', accountId: 12345 })
      );
      mockBackupRepo.create.mockResolvedValue(mockBackup);
      mockBackupRepo.countByOrg.mockResolvedValue(2);
      mockApiKeyRepo.update.mockResolvedValue({});

      const results = await service.backupAllDashboards({
        orgId: 'org-123',
        apiKeyId: 'key-456',
      });

      expect(results).toHaveLength(2);
    });
  });
});
