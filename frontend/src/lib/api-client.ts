import { fetchAuthSession } from 'aws-amplify/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function getAuthHeaders(): Promise<HeadersInit> {
  try {
    const session = await fetchAuthSession();
    // Cognito User Pools Authorizer requires ID token, not access token
    const token = session.tokens?.idToken?.toString();
    console.log('[API] Auth session:', {
      hasTokens: !!session.tokens,
      hasIdToken: !!session.tokens?.idToken,
      hasAccessToken: !!session.tokens?.accessToken,
      tokenPrefix: token ? token.substring(0, 50) + '...' : 'NO TOKEN',
    });
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  } catch (err) {
    console.error('[API] Failed to get auth session:', err);
    return { 'Content-Type': 'application/json' };
  }
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await getAuthHeaders();
  const url = `${API_URL}${endpoint}`;
  console.log('[API] Request:', {
    url,
    method: options.method || 'GET',
    hasAuth: 'Authorization' in headers,
  });

  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  console.log('[API] Response:', {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    console.error('[API] Error response:', error);
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  // Handle 204 No Content responses (e.g., DELETE)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Types
export interface OrganizationSettings {
  backupFrequency?: 'HOURLY' | 'DAILY' | 'WEEKLY';
  retentionDays?: number;
  notificationEmail?: string;
  webhookUrl?: string;
}

export interface Organization {
  orgId: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
  subscriptionTier: 'FREE' | 'PRO' | 'ENTERPRISE';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  settings?: OrganizationSettings;
}

export interface Subscription {
  tier: 'FREE' | 'PRO' | 'ENTERPRISE';
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  currentPeriodEnd?: string;
}

export interface ApiKey {
  apiKeyId: string;
  name: string;
  newRelicAccountIds: string[];
  maskedKey: string;
  status: 'ACTIVE' | 'INVALID' | 'SUSPENDED';
  lastValidated?: string;
  createdAt: string;
}

export interface Dashboard {
  guid: string;
  name: string;
  accountId: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  permissions: string;
  pageCount: number;
  lastBackup?: string;
  backupCount: number;
}

export interface BackupSnapshot {
  id: string;
  dashboardGuid: string;
  dashboardName: string;
  version: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  s3Key: string;
  sizeBytes: number;
  checksum: string;
  createdAt: string;
  updatedAt?: string; // Last updated in New Relic
  metadata: {
    pageCount: number;
    widgetCount: number;
    triggeredBy: 'MANUAL' | 'SCHEDULED';
  };
}

export interface User {
  id: string;
  email: string;
  organizationIds: string[];
  createdAt: string;
}

export interface OrgMember {
  userId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'USER';
  joinedAt: string;
}

// API Functions

// Paginated response type from backend
interface PaginatedResponse<T> {
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

// Organizations
export async function getOrganizations(): Promise<Organization[]> {
  const response = await apiRequest<PaginatedResponse<Organization>>('/organizations');
  return response.data;
}

export async function getOrganization(orgId: string): Promise<Organization> {
  return apiRequest<Organization>(`/organizations/${orgId}`);
}

export async function createOrganization(name: string): Promise<Organization> {
  return apiRequest<Organization>('/organizations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateOrganization(
  orgId: string,
  data: { name?: string; settings?: Partial<OrganizationSettings> }
): Promise<Organization> {
  return apiRequest<Organization>(`/organizations/${orgId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await apiRequest(`/organizations/${orgId}`, { method: 'DELETE' });
}

// Organization Members
export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const response = await apiRequest<PaginatedResponse<OrgMember> | OrgMember[]>(`/organizations/${orgId}/members`);
  if (Array.isArray(response)) {
    return response;
  }
  return response.data;
}

export async function inviteMember(orgId: string, email: string, role: string): Promise<void> {
  await apiRequest(`/organizations/${orgId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  await apiRequest(`/organizations/${orgId}/members/${userId}`, { method: 'DELETE' });
}

// API Keys
export async function getApiKeys(orgId: string): Promise<ApiKey[]> {
  const response = await apiRequest<PaginatedResponse<ApiKey> | ApiKey[]>(`/organizations/${orgId}/api-keys`);
  // Handle both paginated and non-paginated responses
  if (Array.isArray(response)) {
    return response;
  }
  return response.data;
}

export async function createApiKey(
  orgId: string,
  data: { name: string; apiKey: string }
): Promise<ApiKey> {
  return apiRequest<ApiKey>(`/organizations/${orgId}/api-keys`, {
    method: 'POST',
    body: JSON.stringify({
      name: data.name,
      newRelicApiKey: data.apiKey,
    }),
  });
}

export async function deleteApiKey(orgId: string, keyId: string): Promise<void> {
  await apiRequest(`/organizations/${orgId}/api-keys/${keyId}`, { method: 'DELETE' });
}

export async function validateApiKey(
  orgId: string,
  keyId: string
): Promise<{ valid: boolean; accounts: { id: string; name: string }[] }> {
  return apiRequest(`/organizations/${orgId}/api-keys/${keyId}/validate`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// Dashboards
export async function getDashboards(orgId: string, accountId?: string): Promise<Dashboard[]> {
  const params = accountId ? `?accountId=${accountId}` : '';
  const response = await apiRequest<PaginatedResponse<Dashboard> | Dashboard[]>(`/organizations/${orgId}/dashboards${params}`);
  if (Array.isArray(response)) {
    return response;
  }
  return response.data;
}

export async function getDashboard(orgId: string, guid: string): Promise<Dashboard> {
  return apiRequest<Dashboard>(`/organizations/${orgId}/dashboards/${guid}`);
}

export async function getDashboardVersions(orgId: string, guid: string): Promise<BackupSnapshot[]> {
  return apiRequest<BackupSnapshot[]>(`/organizations/${orgId}/dashboards/${guid}/versions`);
}

// Backups
export async function triggerBackup(
  orgId: string,
  apiKeyId: string,
  accountId?: string
): Promise<{ message: string; resultsCount: number; results: unknown[] }> {
  return apiRequest(`/organizations/${orgId}/backup/trigger`, {
    method: 'POST',
    body: JSON.stringify({ apiKeyId, accountId }),
  });
}

export async function restoreDashboard(
  orgId: string,
  guid: string,
  snapshotId: string,
  targetAccountId?: string
): Promise<{ jobId: string; status: string }> {
  return apiRequest(`/organizations/${orgId}/dashboards/${guid}/restore`, {
    method: 'POST',
    body: JSON.stringify({ snapshotId, targetAccountId }),
  });
}

// Get backup content (JSON)
export async function getBackupContent(orgId: string, snapshotId: string): Promise<unknown> {
  return apiRequest(`/organizations/${orgId}/backups/${snapshotId}/content`);
}

// Backend backup type (different from frontend BackupSnapshot)
interface BackendBackup {
  snapshotId: string;
  dashboardGuid: string;
  dashboardName: string;
  accountId: string;
  accountName: string;
  ownerEmail?: string;
  s3Key: string;
  s3Bucket: string;
  backupTimestamp: string;
  dashboardUpdatedAt?: string;
  sizeBytes: number;
  checksum: string;
}

// Response type for paginated backups
export interface PaginatedBackupResponse {
  data: BackupSnapshot[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Get paginated backups for org (single page)
export async function getBackupsPaginated(
  orgId: string,
  page: number = 1,
  limit: number = 50,
  search?: string
): Promise<PaginatedBackupResponse> {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (search) {
    params.set('search', search);
  }

  const response = await apiRequest<PaginatedResponse<BackendBackup>>(
    `/organizations/${orgId}/backups?${params.toString()}`
  );

  // Transform backend format to frontend format
  const data = response.data.map((b) => ({
    id: b.snapshotId,
    dashboardGuid: b.dashboardGuid,
    dashboardName: b.dashboardName,
    version: 1,
    status: 'COMPLETED' as const,
    s3Key: b.s3Key,
    sizeBytes: b.sizeBytes,
    checksum: b.checksum,
    createdAt: b.backupTimestamp,
    updatedAt: b.dashboardUpdatedAt,
    metadata: {
      pageCount: 0,
      widgetCount: 0,
      triggeredBy: 'SCHEDULED' as const,
    },
  }));

  return {
    data,
    pagination: response.pagination,
  };
}

// Get all backups for org (from our database, not New Relic)
// Fetches all pages of results - use sparingly for large datasets
export async function getBackups(orgId: string): Promise<BackupSnapshot[]> {
  const allBackups: BackendBackup[] = [];
  let page = 1;
  const limit = 100; // Max allowed by backend
  let hasMore = true;

  while (hasMore) {
    const response = await apiRequest<PaginatedResponse<BackendBackup>>(
      `/organizations/${orgId}/backups?page=${page}&limit=${limit}`
    );

    allBackups.push(...response.data);
    hasMore = response.pagination.hasNext;
    page++;

    // Safety limit to prevent infinite loops
    if (page > 1000) break;
  }

  // Transform backend format to frontend format
  return allBackups.map((b) => ({
    id: b.snapshotId,
    dashboardGuid: b.dashboardGuid,
    dashboardName: b.dashboardName,
    version: 1, // Version not tracked in backend yet
    status: 'COMPLETED' as const,
    s3Key: b.s3Key,
    sizeBytes: b.sizeBytes,
    checksum: b.checksum,
    createdAt: b.backupTimestamp,
    metadata: {
      pageCount: 0, // Not tracked in current backup
      widgetCount: 0, // Not tracked in current backup
      triggeredBy: 'SCHEDULED' as const,
    },
  }));
}

// User
export async function getCurrentUser(): Promise<User> {
  return apiRequest<User>('/users/me');
}
