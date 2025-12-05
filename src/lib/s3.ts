import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    const endpoint = process.env['AWS_ENDPOINT'];
    s3Client = new S3Client({
      ...(endpoint ? { endpoint } : {}),
      region: process.env['AWS_REGION'] || 'us-east-2',
      forcePathStyle: !!endpoint, // Required for LocalStack
    });
  }
  return s3Client;
}

export const BACKUP_BUCKET = process.env['S3_BUCKET'] || 'groundhog-backups-dev';

export async function putObject(
  bucket: string,
  key: string,
  body: string,
  contentType: string = 'application/json'
): Promise<void> {
  const client = getS3Client();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function getObject(bucket: string, key: string): Promise<string | null> {
  const client = getS3Client();
  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    return (await response.Body?.transformToString()) ?? null;
  } catch (error) {
    if ((error as Error).name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

export async function deleteObject(bucket: string, key: string): Promise<void> {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

export async function getPresignedUrl(
  bucket: string,
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

export function generateBackupKey(
  orgId: string,
  accountId: string,
  dashboardGuid: string,
  timestamp: string
): string {
  const safeGuid = encodeURIComponent(dashboardGuid);
  const safeTimestamp = timestamp.replace(/[:.]/g, '-');
  return `${orgId}/${accountId}/${safeGuid}/${safeTimestamp}.json`;
}
