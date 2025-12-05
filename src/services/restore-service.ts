import { BackupService } from '@/services/backup-service';
import { ApiKeyService } from '@/services/apikey-service';
import { BackupRepository } from '@/repositories/backup-repository';
import { ApiKeyRepository } from '@/repositories/apikey-repository';
import { Backup } from '@/types';
import { NotFoundError, BadRequestError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export interface RestoreOptions {
  orgId: string;
  snapshotId: string;
  apiKeyId: string;
  targetAccountId?: string;
  newName?: string;
}

export interface RestoreResult {
  success: boolean;
  newDashboardGuid?: string;
  message: string;
}

export interface CompareResult {
  snapshotId: string;
  dashboardGuid: string;
  hasChanges: boolean;
  currentVersion?: unknown;
  backupVersion?: unknown;
  changedFields?: string[];
}

export class RestoreService {
  private backupService: BackupService;
  private apiKeyService: ApiKeyService;
  private backupRepository: BackupRepository;
  private apiKeyRepository: ApiKeyRepository;

  constructor(
    backupService?: BackupService,
    apiKeyService?: ApiKeyService,
    backupRepository?: BackupRepository,
    apiKeyRepository?: ApiKeyRepository
  ) {
    this.backupRepository = backupRepository || new BackupRepository();
    this.apiKeyRepository = apiKeyRepository || new ApiKeyRepository();
    this.apiKeyService = apiKeyService || new ApiKeyService(this.apiKeyRepository);
    this.backupService =
      backupService || new BackupService(this.backupRepository, this.apiKeyService, this.apiKeyRepository);
  }

  async restoreDashboard(options: RestoreOptions): Promise<RestoreResult> {
    const { orgId, snapshotId, apiKeyId, targetAccountId, newName } = options;

    // Get the backup
    const backup = await this.backupService.getBackup(orgId, snapshotId);

    // Get the backup content
    const content = await this.backupService.getBackupContent(orgId, snapshotId);
    const dashboardData = JSON.parse(content);

    // Get New Relic client
    const nrClient = await this.apiKeyService.getNewRelicClient(orgId, apiKeyId);

    // Determine target account
    const targetAccount = targetAccountId || backup.accountId;

    // Modify dashboard data if needed
    if (newName) {
      dashboardData.name = newName;
    }

    // Remove GUIDs and IDs that would conflict
    const cleanedDashboard = this.cleanDashboardForRestore(dashboardData);

    try {
      // Create new dashboard in New Relic
      const newGuid = await nrClient.createDashboard(
        targetAccount,
        JSON.stringify(cleanedDashboard)
      );

      logger.info(
        {
          orgId,
          snapshotId,
          originalGuid: backup.dashboardGuid,
          newGuid,
          targetAccount,
        },
        'Dashboard restored'
      );

      return {
        success: true,
        newDashboardGuid: newGuid,
        message: `Dashboard restored successfully. New GUID: ${newGuid}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, orgId, snapshotId }, 'Dashboard restore failed');

      return {
        success: false,
        message: `Restore failed: ${errorMessage}`,
      };
    }
  }

  async restoreInPlace(options: RestoreOptions): Promise<RestoreResult> {
    const { orgId, snapshotId, apiKeyId } = options;

    // Get the backup
    const backup = await this.backupService.getBackup(orgId, snapshotId);

    // Get the backup content
    const content = await this.backupService.getBackupContent(orgId, snapshotId);
    const dashboardData = JSON.parse(content);

    // Get New Relic client
    const nrClient = await this.apiKeyService.getNewRelicClient(orgId, apiKeyId);

    try {
      // Update existing dashboard
      await nrClient.updateDashboard(backup.dashboardGuid, JSON.stringify(dashboardData));

      logger.info(
        { orgId, snapshotId, guid: backup.dashboardGuid },
        'Dashboard restored in place'
      );

      return {
        success: true,
        newDashboardGuid: backup.dashboardGuid,
        message: 'Dashboard restored in place successfully',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error, orgId, snapshotId }, 'In-place restore failed');

      return {
        success: false,
        message: `Restore failed: ${errorMessage}`,
      };
    }
  }

  async compareWithCurrent(
    orgId: string,
    snapshotId: string,
    apiKeyId: string
  ): Promise<CompareResult> {
    // Get the backup
    const backup = await this.backupService.getBackup(orgId, snapshotId);

    // Get backup content
    const backupContent = await this.backupService.getBackupContent(orgId, snapshotId);
    const backupDashboard = JSON.parse(backupContent);

    // Get current dashboard from New Relic
    const nrClient = await this.apiKeyService.getNewRelicClient(orgId, apiKeyId);
    const currentDashboard = await nrClient.getDashboard(backup.dashboardGuid);

    if (!currentDashboard) {
      return {
        snapshotId,
        dashboardGuid: backup.dashboardGuid,
        hasChanges: true,
        backupVersion: backupDashboard,
        changedFields: ['Dashboard no longer exists in New Relic'],
      };
    }

    // Compare key fields
    const changedFields: string[] = [];

    if (backupDashboard.name !== currentDashboard.name) {
      changedFields.push('name');
    }

    if (backupDashboard.description !== currentDashboard.description) {
      changedFields.push('description');
    }

    if (JSON.stringify(backupDashboard.pages) !== JSON.stringify(currentDashboard.pages)) {
      changedFields.push('pages');
    }

    if (JSON.stringify(backupDashboard.variables) !== JSON.stringify(currentDashboard.variables)) {
      changedFields.push('variables');
    }

    return {
      snapshotId,
      dashboardGuid: backup.dashboardGuid,
      hasChanges: changedFields.length > 0,
      currentVersion: currentDashboard,
      backupVersion: backupDashboard,
      changedFields,
    };
  }

  private cleanDashboardForRestore(dashboard: Record<string, unknown>): Record<string, unknown> {
    // Create a copy
    const cleaned = { ...dashboard };

    // Remove fields that would conflict
    delete cleaned['guid'];
    delete cleaned['accountId'];
    delete cleaned['createdAt'];
    delete cleaned['updatedAt'];

    // Clean pages
    if (Array.isArray(cleaned['pages'])) {
      cleaned['pages'] = (cleaned['pages'] as Array<Record<string, unknown>>).map(
        (page) => {
          const cleanedPage = { ...page };
          delete cleanedPage['guid'];

          if (Array.isArray(cleanedPage['widgets'])) {
            cleanedPage['widgets'] = (
              cleanedPage['widgets'] as Array<Record<string, unknown>>
            ).map((widget) => {
              const cleanedWidget = { ...widget };
              delete cleanedWidget['id'];
              return cleanedWidget;
            });
          }

          return cleanedPage;
        }
      );
    }

    return cleaned;
  }
}
