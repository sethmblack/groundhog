import * as crypto from 'crypto';
import { BackupRepository, CreateBackupInput } from '@/repositories/backup-repository';
import { ApiKeyService } from '@/services/apikey-service';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { putObject, getObject, BACKUP_BUCKET, generateBackupKey } from '@/lib/s3';
import { Backup, Dashboard, PaginatedResponse, Pagination } from '@/types';
import { NotFoundError, BadRequestError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface BackupDashboardInput {
  orgId: string;
  apiKeyId: string;
  dashboardGuid: string;
}

export interface BackupAllInput {
  orgId: string;
  apiKeyId: string;
  accountId?: string;
}

export interface BackupResult {
  snapshotId: string;
  dashboardGuid: string;
  dashboardName: string;
  sizeBytes: number;
  backupTimestamp: string;
}

export class BackupService {
  private backupRepository: BackupRepository;
  private apiKeyService: ApiKeyService;
  private apiKeyRepository: ApiKeyRepository;

  constructor(
    backupRepository?: BackupRepository,
    apiKeyService?: ApiKeyService,
    apiKeyRepository?: ApiKeyRepository
  ) {
    this.backupRepository = backupRepository || new BackupRepository();
    this.apiKeyRepository = apiKeyRepository || new ApiKeyRepository();
    this.apiKeyService = apiKeyService || new ApiKeyService(this.apiKeyRepository);
  }

  async backupDashboard(input: BackupDashboardInput): Promise<BackupResult> {
    const { orgId, apiKeyId, dashboardGuid } = input;

    // Get New Relic client
    const nrClient = await this.apiKeyService.getNewRelicClient(orgId, apiKeyId);

    // Fetch dashboard from New Relic
    const dashboardJson = await nrClient.getDashboardJson(dashboardGuid);
    if (!dashboardJson) {
      throw new NotFoundError('Dashboard not found in New Relic');
    }

    const dashboard = JSON.parse(dashboardJson);
    const timestamp = new Date().toISOString();

    // Generate S3 key
    const s3Key = generateBackupKey(
      orgId,
      String(dashboard.accountId),
      dashboardGuid,
      timestamp
    );

    // Calculate checksum
    const checksum = crypto.createHash('sha256').update(dashboardJson).digest('hex');
    const sizeBytes = Buffer.byteLength(dashboardJson, 'utf8');

    // Store in S3
    await putObject(BACKUP_BUCKET, s3Key, dashboardJson);

    // Create backup record
    const backup = await this.backupRepository.create({
      orgId,
      dashboardGuid,
      dashboardName: dashboard.name,
      accountId: String(dashboard.accountId),
      accountName: '', // Could be enriched later
      ownerEmail: dashboard.owner?.email,
      s3Key,
      s3Bucket: BACKUP_BUCKET,
      dashboardUpdatedAt: dashboard.updatedAt,
      sizeBytes,
      checksum,
    });

    // Update API key dashboard count
    const backupCount = await this.backupRepository.countByOrg(orgId);
    await this.apiKeyRepository.update(orgId, apiKeyId, {
      dashboardCount: backupCount,
      lastBackupRun: timestamp,
    });

    logger.info(
      {
        orgId,
        apiKeyId,
        dashboardGuid,
        snapshotId: backup.snapshotId,
        sizeBytes,
      },
      'Dashboard backed up'
    );

    return {
      snapshotId: backup.snapshotId,
      dashboardGuid: backup.dashboardGuid,
      dashboardName: backup.dashboardName,
      sizeBytes: backup.sizeBytes,
      backupTimestamp: backup.backupTimestamp,
    };
  }

  async backupAllDashboards(input: BackupAllInput): Promise<BackupResult[]> {
    const { orgId, apiKeyId, accountId } = input;

    // Get New Relic client
    const nrClient = await this.apiKeyService.getNewRelicClient(orgId, apiKeyId);

    // Get API key to determine which accounts to backup
    const apiKey = await this.apiKeyRepository.findById(orgId, apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found');
    }

    const accountsToBackup = accountId
      ? [accountId]
      : apiKey.newRelicAccountIds;

    const results: BackupResult[] = [];
    const errors: Array<{ dashboardGuid: string; error: string }> = [];

    for (const accId of accountsToBackup) {
      try {
        // List dashboards for this account
        const dashboards = await nrClient.listDashboards(accId);

        logger.info(
          { orgId, apiKeyId, accountId: accId, dashboardCount: dashboards.length },
          'Found dashboards to backup'
        );

        // Backup each dashboard
        for (const dashboard of dashboards) {
          try {
            const result = await this.backupDashboard({
              orgId,
              apiKeyId,
              dashboardGuid: dashboard.guid,
            });
            results.push(result);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            errors.push({ dashboardGuid: dashboard.guid, error: errorMessage });
            logger.warn(
              { orgId, dashboardGuid: dashboard.guid, error: errorMessage },
              'Failed to backup dashboard'
            );
          }
        }
      } catch (error) {
        logger.error(
          { orgId, apiKeyId, accountId: accId, error },
          'Failed to list dashboards for account'
        );
      }
    }

    logger.info(
      { orgId, apiKeyId, successCount: results.length, errorCount: errors.length },
      'Backup all dashboards completed'
    );

    return results;
  }

  async getBackup(orgId: string, snapshotId: string): Promise<Backup> {
    const backup = await this.backupRepository.findById(orgId, snapshotId);
    if (!backup) {
      throw new NotFoundError('Backup not found');
    }
    return backup;
  }

  async getBackupContent(orgId: string, snapshotId: string): Promise<string> {
    const backup = await this.getBackup(orgId, snapshotId);

    const content = await getObject(backup.s3Bucket, backup.s3Key);
    if (!content) {
      throw new NotFoundError('Backup content not found in storage');
    }

    return content;
  }

  async listBackupsByDashboard(
    orgId: string,
    dashboardGuid: string,
    pagination: Pagination
  ): Promise<PaginatedResponse<Backup>> {
    const allBackups = await this.backupRepository.listByDashboard(
      orgId,
      dashboardGuid,
      100
    );

    const start = (pagination.page - 1) * pagination.limit;
    const end = start + pagination.limit;
    const paginatedBackups = allBackups.slice(start, end);

    return {
      data: paginatedBackups,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: allBackups.length,
        totalPages: Math.ceil(allBackups.length / pagination.limit),
        hasNext: end < allBackups.length,
        hasPrev: pagination.page > 1,
      },
    };
  }

  async listBackupsByOrg(
    orgId: string,
    pagination: Pagination,
    search?: string
  ): Promise<PaginatedResponse<Backup>> {
    // If search is provided, we need to scan and filter (slower but necessary)
    if (search && search.trim()) {
      const searchLower = search.toLowerCase().trim();
      // Fetch more items to filter through, but limit to reasonable amount
      const allBackups = await this.backupRepository.listByOrg(orgId, 1000);
      const filtered = allBackups.filter(
        (backup) =>
          backup.dashboardName.toLowerCase().includes(searchLower) ||
          backup.dashboardGuid.toLowerCase().includes(searchLower)
      );

      const start = (pagination.page - 1) * pagination.limit;
      const end = start + pagination.limit;
      const paginatedBackups = filtered.slice(start, end);

      return {
        data: paginatedBackups,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: filtered.length,
          totalPages: Math.ceil(filtered.length / pagination.limit),
          hasNext: end < filtered.length,
          hasPrev: pagination.page > 1,
        },
      };
    }

    // No search - use efficient DynamoDB pagination
    const result = await this.backupRepository.listByOrgPaginated(
      orgId,
      pagination.page,
      pagination.limit
    );

    return result;
  }

  async getStorageStats(orgId: string): Promise<{
    totalBackups: number;
    totalSizeBytes: number;
    oldestBackup?: string;
    newestBackup?: string;
  }> {
    const backups = await this.backupRepository.listByOrg(orgId, 10000);

    if (backups.length === 0) {
      return {
        totalBackups: 0,
        totalSizeBytes: 0,
      };
    }

    const totalSizeBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
    const timestamps = backups.map((b) => b.backupTimestamp).sort();

    return {
      totalBackups: backups.length,
      totalSizeBytes,
      oldestBackup: timestamps[0],
      newestBackup: timestamps[timestamps.length - 1],
    };
  }
}
