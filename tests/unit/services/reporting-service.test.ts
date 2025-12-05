import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReportingService } from '@/services/reporting-service';
import { BackupRepository } from '@/repositories/backup-repository';
import { AuditRepository } from '@/repositories/audit-repository';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { OrganizationRepository } from '@/repositories/organization-repository';

describe('ReportingService', () => {
  let reportingService: ReportingService;
  let mockBackupRepo: BackupRepository;
  let mockAuditRepo: AuditRepository;
  let mockApiKeyRepo: ApiKeyRepository;
  let mockOrgRepo: OrganizationRepository;

  beforeEach(() => {
    mockBackupRepo = {
      listByOrg: vi.fn(),
      listByDashboard: vi.fn(),
    } as unknown as BackupRepository;

    mockAuditRepo = {
      listByOrg: vi.fn(),
    } as unknown as AuditRepository;

    mockApiKeyRepo = {
      listByOrg: vi.fn(),
    } as unknown as ApiKeyRepository;

    mockOrgRepo = {
      findById: vi.fn(),
    } as unknown as OrganizationRepository;

    reportingService = new ReportingService(
      mockBackupRepo,
      mockAuditRepo,
      mockApiKeyRepo,
      mockOrgRepo
    );
  });

  describe('getUsageReport', () => {
    it('should return usage report with backup statistics', async () => {
      vi.mocked(mockOrgRepo.findById).mockResolvedValue({
        id: 'org-123',
        name: 'Test Org',
        subscriptionTier: 'PRO',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      vi.mocked(mockBackupRepo.listByOrg).mockResolvedValue([
        {
          snapshotId: 'snap-1',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'COMPLETED',
          sizeBytes: 1000,
          createdAt: '2024-01-15T10:00:00Z',
        },
        {
          snapshotId: 'snap-2',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-2',
          status: 'COMPLETED',
          sizeBytes: 2000,
          createdAt: '2024-01-16T10:00:00Z',
        },
        {
          snapshotId: 'snap-3',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'FAILED',
          createdAt: '2024-01-17T10:00:00Z',
        },
      ]);

      vi.mocked(mockApiKeyRepo.listByOrg).mockResolvedValue([
        {
          id: 'key-1',
          orgId: 'org-123',
          name: 'Key 1',
          accountId: '12345',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'key-2',
          orgId: 'org-123',
          name: 'Key 2',
          accountId: '12346',
          status: 'REVOKED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);

      const report = await reportingService.getUsageReport(
        'org-123',
        '2024-01-01',
        '2024-01-31'
      );

      expect(report.orgId).toBe('org-123');
      expect(report.backups.total).toBe(3);
      expect(report.backups.successful).toBe(2);
      expect(report.backups.failed).toBe(1);
      expect(report.backups.totalSizeBytes).toBe(3000);
      expect(report.dashboards.uniqueCount).toBe(2);
      expect(report.apiKeys.total).toBe(2);
      expect(report.apiKeys.active).toBe(1);
    });

    it('should use FREE tier limits for unknown organization', async () => {
      vi.mocked(mockOrgRepo.findById).mockResolvedValue(null);
      vi.mocked(mockBackupRepo.listByOrg).mockResolvedValue([]);
      vi.mocked(mockApiKeyRepo.listByOrg).mockResolvedValue([]);

      const report = await reportingService.getUsageReport(
        'org-123',
        '2024-01-01',
        '2024-01-31'
      );

      expect(report.storage.limitBytes).toBe(100 * 1024 * 1024); // FREE tier limit
    });
  });

  describe('getBackupSummaryByDay', () => {
    it('should group backups by day', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      vi.mocked(mockBackupRepo.listByOrg).mockResolvedValue([
        {
          snapshotId: 'snap-1',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'COMPLETED',
          sizeBytes: 1000,
          createdAt: yesterday.toISOString(),
        },
        {
          snapshotId: 'snap-2',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-2',
          status: 'COMPLETED',
          sizeBytes: 2000,
          createdAt: yesterday.toISOString(),
        },
        {
          snapshotId: 'snap-3',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'FAILED',
          createdAt: twoDaysAgo.toISOString(),
        },
      ]);

      const summary = await reportingService.getBackupSummaryByDay('org-123', 7);

      expect(summary.length).toBe(2);
      const yesterdaySummary = summary.find(
        (s) => s.date === yesterday.toISOString().split('T')[0]
      );
      expect(yesterdaySummary?.successCount).toBe(2);
      expect(yesterdaySummary?.totalSizeBytes).toBe(3000);
    });

    it('should return empty array when no backups exist', async () => {
      vi.mocked(mockBackupRepo.listByOrg).mockResolvedValue([]);

      const summary = await reportingService.getBackupSummaryByDay('org-123', 7);

      expect(summary).toEqual([]);
    });
  });

  describe('getAuditSummary', () => {
    it('should group audit logs by event type', async () => {
      vi.mocked(mockAuditRepo.listByOrg).mockResolvedValue([
        {
          eventId: 'event-1',
          orgId: 'org-123',
          eventType: 'USER_LOGIN',
          timestamp: '2024-01-15T10:00:00Z',
        },
        {
          eventId: 'event-2',
          orgId: 'org-123',
          eventType: 'USER_LOGIN',
          timestamp: '2024-01-16T10:00:00Z',
        },
        {
          eventId: 'event-3',
          orgId: 'org-123',
          eventType: 'API_KEY_CREATED',
          timestamp: '2024-01-15T11:00:00Z',
        },
      ]);

      const summary = await reportingService.getAuditSummary('org-123');

      expect(summary.length).toBe(2);
      const loginSummary = summary.find((s) => s.eventType === 'USER_LOGIN');
      expect(loginSummary?.count).toBe(2);
      expect(loginSummary?.lastOccurrence).toBe('2024-01-16T10:00:00Z');
    });
  });

  describe('getDashboardBackupHistory', () => {
    it('should return backup history for a specific dashboard', async () => {
      vi.mocked(mockBackupRepo.listByDashboard).mockResolvedValue([
        {
          snapshotId: 'snap-1',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'COMPLETED',
          sizeBytes: 1000,
          createdAt: '2024-01-15T10:00:00Z',
        },
        {
          snapshotId: 'snap-2',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'COMPLETED',
          sizeBytes: 1100,
          createdAt: '2024-01-16T10:00:00Z',
        },
      ]);

      const history = await reportingService.getDashboardBackupHistory(
        'org-123',
        'dash-1'
      );

      expect(history.length).toBe(2);
      expect(history[0].snapshotId).toBe('snap-1');
      expect(history[0].sizeBytes).toBe(1000);
    });

    it('should filter out failed backups', async () => {
      vi.mocked(mockBackupRepo.listByDashboard).mockResolvedValue([
        {
          snapshotId: 'snap-1',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'COMPLETED',
          sizeBytes: 1000,
          createdAt: '2024-01-15T10:00:00Z',
        },
        {
          snapshotId: 'snap-2',
          orgId: 'org-123',
          apiKeyId: 'key-1',
          dashboardGuid: 'dash-1',
          status: 'FAILED',
          createdAt: '2024-01-16T10:00:00Z',
        },
      ]);

      const history = await reportingService.getDashboardBackupHistory(
        'org-123',
        'dash-1'
      );

      expect(history.length).toBe(1);
      expect(history[0].snapshotId).toBe('snap-1');
    });
  });
});
