import { SQSEvent, SQSRecord, Context } from 'aws-lambda';
import { BackupService } from '@/services/backup-service';
import { logger } from '@/lib/logger';

export interface BackupMessage {
  type: 'BACKUP_SINGLE' | 'BACKUP_ALL';
  orgId: string;
  apiKeyId: string;
  dashboardGuid?: string;
  accountId?: string;
  requestId: string;
  timestamp: string;
}

const backupService = new BackupService();

export async function handler(event: SQSEvent, _context: Context): Promise<void> {
  logger.info({ recordCount: event.Records.length }, 'Processing backup queue');

  const results = await Promise.allSettled(
    event.Records.map((record) => processRecord(record))
  );

  const failures = results.filter((r) => r.status === 'rejected');
  if (failures.length > 0) {
    logger.error(
      { failureCount: failures.length, totalCount: results.length },
      'Some backup jobs failed'
    );
    // In production, failed records would be sent to DLQ
  }

  logger.info(
    {
      successCount: results.filter((r) => r.status === 'fulfilled').length,
      failureCount: failures.length,
    },
    'Backup queue processing completed'
  );
}

async function processRecord(record: SQSRecord): Promise<void> {
  const message: BackupMessage = JSON.parse(record.body);

  logger.info(
    { messageType: message.type, orgId: message.orgId, requestId: message.requestId },
    'Processing backup message'
  );

  try {
    switch (message.type) {
      case 'BACKUP_SINGLE':
        if (!message.dashboardGuid) {
          throw new Error('dashboardGuid required for BACKUP_SINGLE');
        }
        await backupService.backupDashboard({
          orgId: message.orgId,
          apiKeyId: message.apiKeyId,
          dashboardGuid: message.dashboardGuid,
        });
        break;

      case 'BACKUP_ALL':
        await backupService.backupAllDashboards({
          orgId: message.orgId,
          apiKeyId: message.apiKeyId,
          accountId: message.accountId,
        });
        break;

      default:
        logger.warn({ messageType: message.type }, 'Unknown message type');
    }

    logger.info({ requestId: message.requestId }, 'Backup job completed');
  } catch (error) {
    logger.error(
      { error, requestId: message.requestId, messageType: message.type },
      'Backup job failed'
    );
    throw error;
  }
}
