import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { logger } from '@/lib/logger';

export interface EmailNotification {
  to: string | string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
}

export interface SmsNotification {
  phoneNumber: string;
  message: string;
}

export interface NotificationPreferences {
  email: boolean;
  emailAddress?: string;
  sms: boolean;
  phoneNumber?: string;
  backupSuccess: boolean;
  backupFailure: boolean;
  weeklyReport: boolean;
}

export class NotificationService {
  private sesClient: SESClient;
  private snsClient: SNSClient;
  private fromEmail: string;

  constructor() {
    const endpoint = process.env['AWS_ENDPOINT'];
    this.sesClient = new SESClient({
      ...(endpoint ? { endpoint } : {}),
      region: process.env['AWS_REGION'] || 'us-east-2',
    });
    this.snsClient = new SNSClient({
      ...(endpoint ? { endpoint } : {}),
      region: process.env['AWS_REGION'] || 'us-east-2',
    });
    this.fromEmail = process.env['FROM_EMAIL'] || 'noreply@groundhog.io';
  }

  async sendEmail(notification: EmailNotification): Promise<void> {
    const toAddresses = Array.isArray(notification.to)
      ? notification.to
      : [notification.to];

    try {
      await this.sesClient.send(
        new SendEmailCommand({
          Source: this.fromEmail,
          Destination: {
            ToAddresses: toAddresses,
          },
          Message: {
            Subject: {
              Data: notification.subject,
              Charset: 'UTF-8',
            },
            Body: {
              Html: {
                Data: notification.htmlBody,
                Charset: 'UTF-8',
              },
              ...(notification.textBody
                ? {
                    Text: {
                      Data: notification.textBody,
                      Charset: 'UTF-8',
                    },
                  }
                : {}),
            },
          },
        })
      );

      logger.info({ to: toAddresses, subject: notification.subject }, 'Email sent');
    } catch (error) {
      logger.error({ error, to: toAddresses }, 'Failed to send email');
      throw error;
    }
  }

  async sendBackupSuccessNotification(
    email: string,
    orgName: string,
    dashboardCount: number,
    timestamp: string
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: `Groundhog: Backup completed for ${orgName}`,
      htmlBody: `
        <html>
          <body>
            <h2>Backup Completed Successfully</h2>
            <p>Your dashboard backup has completed successfully.</p>
            <ul>
              <li><strong>Organization:</strong> ${orgName}</li>
              <li><strong>Dashboards backed up:</strong> ${dashboardCount}</li>
              <li><strong>Timestamp:</strong> ${timestamp}</li>
            </ul>
            <p>You can view and manage your backups in the Groundhog dashboard.</p>
            <p>— The Groundhog Team</p>
          </body>
        </html>
      `,
      textBody: `Backup completed for ${orgName}. ${dashboardCount} dashboards backed up at ${timestamp}.`,
    });
  }

  async sendBackupFailureNotification(
    email: string,
    orgName: string,
    errorMessage: string,
    timestamp: string
  ): Promise<void> {
    await this.sendEmail({
      to: email,
      subject: `Groundhog: Backup failed for ${orgName}`,
      htmlBody: `
        <html>
          <body>
            <h2>Backup Failed</h2>
            <p>Unfortunately, your dashboard backup has failed.</p>
            <ul>
              <li><strong>Organization:</strong> ${orgName}</li>
              <li><strong>Error:</strong> ${errorMessage}</li>
              <li><strong>Timestamp:</strong> ${timestamp}</li>
            </ul>
            <p>Please check your API key configuration and try again.</p>
            <p>— The Groundhog Team</p>
          </body>
        </html>
      `,
      textBody: `Backup failed for ${orgName}. Error: ${errorMessage}. Time: ${timestamp}.`,
    });
  }

  async sendWeeklyReportNotification(
    email: string,
    orgName: string,
    stats: {
      totalBackups: number;
      newBackupsThisWeek: number;
      totalSizeBytes: number;
      dashboardCount: number;
    }
  ): Promise<void> {
    const sizeMB = (stats.totalSizeBytes / (1024 * 1024)).toFixed(2);

    await this.sendEmail({
      to: email,
      subject: `Groundhog: Weekly report for ${orgName}`,
      htmlBody: `
        <html>
          <body>
            <h2>Weekly Backup Report</h2>
            <p>Here's your weekly summary for ${orgName}:</p>
            <ul>
              <li><strong>Total backups:</strong> ${stats.totalBackups}</li>
              <li><strong>New this week:</strong> ${stats.newBackupsThisWeek}</li>
              <li><strong>Dashboards tracked:</strong> ${stats.dashboardCount}</li>
              <li><strong>Storage used:</strong> ${sizeMB} MB</li>
            </ul>
            <p>— The Groundhog Team</p>
          </body>
        </html>
      `,
    });
  }

  async sendWelcomeEmail(email: string, fullName?: string): Promise<void> {
    const greeting = fullName ? `Hi ${fullName}` : 'Hi there';

    await this.sendEmail({
      to: email,
      subject: 'Welcome to Groundhog!',
      htmlBody: `
        <html>
          <body>
            <h2>${greeting}, welcome to Groundhog!</h2>
            <p>Thank you for signing up. Groundhog helps you automatically backup and restore your New Relic dashboards.</p>
            <h3>Getting Started</h3>
            <ol>
              <li>Create an organization</li>
              <li>Add your New Relic API key</li>
              <li>Start backing up your dashboards</li>
            </ol>
            <p>If you have any questions, don't hesitate to reach out.</p>
            <p>— The Groundhog Team</p>
          </body>
        </html>
      `,
    });
  }
}
