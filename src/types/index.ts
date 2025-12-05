import { z } from 'zod';

// Role definitions
export const RoleSchema = z.enum(['USER', 'ADMIN', 'SUPERUSER']);
export type Role = z.infer<typeof RoleSchema>;

// Status definitions
export const UserStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const OrgStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'TRIAL']);
export type OrgStatus = z.infer<typeof OrgStatusSchema>;

export const SubscriptionTierSchema = z.enum(['FREE', 'PRO', 'ENTERPRISE']);
export type SubscriptionTier = z.infer<typeof SubscriptionTierSchema>;

export const ApiKeyStatusSchema = z.enum(['ACTIVE', 'INVALID', 'SUSPENDED']);
export type ApiKeyStatus = z.infer<typeof ApiKeyStatusSchema>;

// User
export const UserSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().optional(),
  status: UserStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;

// Organization
export const OrganizationSchema = z.object({
  orgId: z.string().uuid(),
  name: z.string().min(1).max(200),
  status: OrgStatusSchema,
  subscriptionTier: SubscriptionTierSchema,
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedAt: z.string().datetime(),
  settings: z.record(z.unknown()).optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

// Organization Membership
export const OrgMembershipSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  role: RoleSchema,
  joinedAt: z.string().datetime(),
  invitedBy: z.string().uuid().optional(),
});
export type OrgMembership = z.infer<typeof OrgMembershipSchema>;

// API Key (metadata only - actual key in Secrets Manager)
export const ApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  orgId: z.string().uuid(),
  name: z.string().min(1).max(100),
  secretArn: z.string(),
  newRelicAccountIds: z.array(z.string()),
  status: ApiKeyStatusSchema,
  lastValidated: z.string().datetime().optional(),
  lastBackupRun: z.string().datetime().optional(),
  dashboardCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
});
export type ApiKey = z.infer<typeof ApiKeySchema>;

// Dashboard
export const DashboardSchema = z.object({
  guid: z.string(),
  name: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  ownerEmail: z.string().email().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

// Backup/Snapshot
export const BackupSchema = z.object({
  snapshotId: z.string().uuid(),
  orgId: z.string().uuid(),
  dashboardGuid: z.string(),
  dashboardName: z.string(),
  accountId: z.string(),
  accountName: z.string(),
  ownerEmail: z.string().email().optional(),
  s3Key: z.string(),
  s3Bucket: z.string(),
  backupTimestamp: z.string().datetime(),
  dashboardUpdatedAt: z.string().datetime().optional(),
  sizeBytes: z.number().int().min(0),
  checksum: z.string(),
});
export type Backup = z.infer<typeof BackupSchema>;

// Audit Log
export const AuditEventTypeSchema = z.enum([
  'USER_CREATED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'ORG_CREATED',
  'ORG_UPDATED',
  'ORG_DELETED',
  'MEMBER_INVITED',
  'MEMBER_REMOVED',
  'APIKEY_CREATED',
  'APIKEY_VALIDATED',
  'APIKEY_DELETED',
  'BACKUP_STARTED',
  'BACKUP_COMPLETED',
  'BACKUP_FAILED',
  'RESTORE_STARTED',
  'RESTORE_COMPLETED',
  'RESTORE_FAILED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELED',
  'PAYMENT_SUCCEEDED',
  'PAYMENT_FAILED',
]);
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>;

export const AuditLogSchema = z.object({
  eventId: z.string().uuid(),
  orgId: z.string().uuid(),
  eventType: AuditEventTypeSchema,
  userId: z.string().uuid().optional(),
  userEmail: z.string().email().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.string().datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// JWT Claims
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email(),
  orgs: z.array(
    z.object({
      orgId: z.string().uuid(),
      role: RoleSchema,
    })
  ),
  iat: z.number(),
  exp: z.number(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// Request Context
export interface RequestContext {
  requestId: string;
  userId: string;
  email: string;
  orgs: Array<{ orgId: string; role: Role }>;
}

export interface OrgContext extends RequestContext {
  orgId: string;
  role: Role;
}

// Pagination
export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
