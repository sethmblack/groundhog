import { BackupRepository } from '@/repositories/backup-repository';
import { AuditRepository } from '@/repositories/audit-repository';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { OrganizationRepository } from '@/repositories/organization-repository';
import { AuditEventType } from '@/types';

export interface UsageReport {
  orgId: string;
  period: {
    start: string;
    end: string;
  };
  backups: {
    total: number;
    successful: number;
    failed: number;
    totalSizeBytes: number;
  };
  dashboards: {
    uniqueCount: number;
    totalSnapshots: number;
  };
  apiKeys: {
    total: number;
    active: number;
  };
  storage: {
    usedBytes: number;
    limitBytes: number;
    percentUsed: number;
  };
}

export interface BackupSummary {
  date: string;
  successCount: number;
  failureCount: number;
  totalSizeBytes: number;
}

export interface AuditSummary {
  eventType: AuditEventType;
  count: number;
  lastOccurrence: string;
}

const TIER_STORAGE_LIMITS: Record<string, number> = {
  FREE: 100 * 1024 * 1024, // 100 MB
  PRO: 1024 * 1024 * 1024, // 1 GB
  ENTERPRISE: 10 * 1024 * 1024 * 1024, // 10 GB
};

export class ReportingService {
  constructor(
    private backupRepository: BackupRepository,
    private auditRepository: AuditRepository,
    private apiKeyRepository: ApiKeyRepository,
    private orgRepository: OrganizationRepository
  ) {}

  async getUsageReport(
    orgId: string,
    startDate: string,
    endDate: string
  ): Promise<UsageReport> {
    // Get organization info for tier limits
    const org = await this.orgRepository.findById(orgId);
    const tier = org?.subscriptionTier || 'FREE';
    const storageLimit = TIER_STORAGE_LIMITS[tier] || TIER_STORAGE_LIMITS['FREE'];

    // Get all backups in the period
    const backups = await this.backupRepository.listByOrg(orgId, 1000);
    const periodBackups = backups.filter(
      (b) => b.createdAt >= startDate && b.createdAt <= endDate
    );

    // Calculate backup statistics
    const successfulBackups = periodBackups.filter((b) => b.status === 'COMPLETED');
    const failedBackups = periodBackups.filter((b) => b.status === 'FAILED');
    const totalSizeBytes = successfulBackups.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);

    // Get unique dashboards
    const uniqueDashboards = new Set(backups.map((b) => b.dashboardGuid));

    // Get API keys
    const apiKeys = await this.apiKeyRepository.listByOrg(orgId);
    const activeApiKeys = apiKeys.filter((k) => k.status === 'ACTIVE');

    // Calculate total storage used
    const allCompletedBackups = backups.filter((b) => b.status === 'COMPLETED');
    const totalStorageUsed = allCompletedBackups.reduce(
      (sum, b) => sum + (b.sizeBytes || 0),
      0
    );

    return {
      orgId,
      period: {
        start: startDate,
        end: endDate,
      },
      backups: {
        total: periodBackups.length,
        successful: successfulBackups.length,
        failed: failedBackups.length,
        totalSizeBytes,
      },
      dashboards: {
        uniqueCount: uniqueDashboards.size,
        totalSnapshots: allCompletedBackups.length,
      },
      apiKeys: {
        total: apiKeys.length,
        active: activeApiKeys.length,
      },
      storage: {
        usedBytes: totalStorageUsed,
        limitBytes: storageLimit,
        percentUsed: Math.round((totalStorageUsed / storageLimit) * 100),
      },
    };
  }

  async getBackupSummaryByDay(
    orgId: string,
    days: number = 30
  ): Promise<BackupSummary[]> {
    const backups = await this.backupRepository.listByOrg(orgId, 1000);
    const now = new Date();
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    // Filter to recent backups
    const recentBackups = backups.filter(
      (b) => new Date(b.createdAt) >= cutoff
    );

    // Group by date
    const byDate = new Map<string, { success: number; failure: number; size: number }>();

    for (const backup of recentBackups) {
      const date = backup.createdAt.split('T')[0];
      const existing = byDate.get(date) || { success: 0, failure: 0, size: 0 };

      if (backup.status === 'COMPLETED') {
        existing.success++;
        existing.size += backup.sizeBytes || 0;
      } else if (backup.status === 'FAILED') {
        existing.failure++;
      }

      byDate.set(date, existing);
    }

    // Convert to array and sort by date
    const summaries: BackupSummary[] = [];
    for (const [date, stats] of byDate.entries()) {
      summaries.push({
        date,
        successCount: stats.success,
        failureCount: stats.failure,
        totalSizeBytes: stats.size,
      });
    }

    return summaries.sort((a, b) => a.date.localeCompare(b.date));
  }

  async getAuditSummary(
    orgId: string,
    startDate?: string,
    endDate?: string
  ): Promise<AuditSummary[]> {
    const auditLogs = await this.auditRepository.listByOrg(orgId, {
      limit: 1000,
      startDate,
      endDate,
    });

    // Group by event type
    const byType = new Map<AuditEventType, { count: number; lastOccurrence: string }>();

    for (const log of auditLogs) {
      const existing = byType.get(log.eventType);
      if (!existing) {
        byType.set(log.eventType, {
          count: 1,
          lastOccurrence: log.timestamp,
        });
      } else {
        existing.count++;
        if (log.timestamp > existing.lastOccurrence) {
          existing.lastOccurrence = log.timestamp;
        }
      }
    }

    // Convert to array
    const summaries: AuditSummary[] = [];
    for (const [eventType, stats] of byType.entries()) {
      summaries.push({
        eventType,
        count: stats.count,
        lastOccurrence: stats.lastOccurrence,
      });
    }

    return summaries.sort((a, b) => b.count - a.count);
  }

  async getDashboardBackupHistory(
    orgId: string,
    dashboardGuid: string,
    limit: number = 50
  ): Promise<{ snapshotId: string; createdAt: string; sizeBytes: number }[]> {
    const backups = await this.backupRepository.listByDashboard(
      orgId,
      dashboardGuid,
      limit
    );

    return backups
      .filter((b) => b.status === 'COMPLETED')
      .map((b) => ({
        snapshotId: b.snapshotId,
        createdAt: b.createdAt,
        sizeBytes: b.sizeBytes || 0,
      }));
  }
}
