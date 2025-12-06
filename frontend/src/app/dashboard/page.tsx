'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useOrg } from '@/context/OrgContext';
import {
  Dashboard,
  BackupSnapshot,
  ApiKey,
  getDashboards,
  getApiKeys,
  getDashboardVersions,
  triggerBackup,
  restoreDashboard,
} from '@/lib/api-client';

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading, error: orgError } = useOrg();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [recentBackups, setRecentBackups] = useState<BackupSnapshot[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState<string | null>(null);
  const [backingUpAll, setBackingUpAll] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin');
      return;
    }
    if (currentOrg) {
      fetchData();
    }
  }, [authLoading, user, currentOrg, router]);

  const fetchData = async () => {
    if (!currentOrg) return;
    setLoading(true);

    try {
      const [dashboardsData, apiKeysData] = await Promise.all([
        getDashboards(currentOrg.orgId).catch(() => []),
        getApiKeys(currentOrg.orgId).catch(() => []),
      ]);

      setDashboards(dashboardsData);
      setApiKeys(apiKeysData);

      // Fetch recent backups from dashboards
      const backupPromises = dashboardsData.slice(0, 5).map((d) =>
        getDashboardVersions(currentOrg.orgId, d.guid).catch(() => [])
      );
      const allVersions = await Promise.all(backupPromises);
      const allBackups = allVersions.flat().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRecentBackups(allBackups.slice(0, 10));
    } catch (err) {
      console.warn('Failed to fetch data, using demo data:', err);
      // Demo data fallback
      setDashboards([
        {
          guid: 'dash-1',
          name: 'Production Overview',
          accountId: '12345',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          permissions: 'PUBLIC',
          pageCount: 3,
          lastBackup: new Date().toISOString(),
          backupCount: 5,
        },
        {
          guid: 'dash-2',
          name: 'User Metrics',
          accountId: '12345',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          permissions: 'PRIVATE',
          pageCount: 2,
          lastBackup: new Date().toISOString(),
          backupCount: 3,
        },
      ]);
      setApiKeys([
        {
          apiKeyId: 'key-1',
          name: 'Production',
          newRelicAccountIds: ['12345'],
          maskedKey: '****ABCD',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
        },
      ]);
      setRecentBackups([
        {
          id: 'snap-1',
          dashboardGuid: 'dash-1',
          dashboardName: 'Production Overview',
          version: 5,
          status: 'COMPLETED',
          s3Key: 'backups/snap-1.json',
          sizeBytes: 45000,
          checksum: 'abc123',
          createdAt: new Date().toISOString(),
          metadata: { pageCount: 3, widgetCount: 12, triggeredBy: 'SCHEDULED' },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleBackupSingle = async (dashboardGuid: string) => {
    // Redirect to backups page for backup functionality
    router.push('/dashboard/backups');
  };

  const handleBackupAll = async () => {
    if (!currentOrg) return;
    if (apiKeys.length === 0) {
      alert('No API keys configured. Please add an API key first.');
      router.push('/dashboard/apikeys');
      return;
    }
    setBackingUpAll(true);
    try {
      // Use the first available API key
      const result = await triggerBackup(currentOrg.orgId, apiKeys[0].apiKeyId);
      alert(`Backup completed! ${result.resultsCount} dashboard(s) backed up.`);
      await fetchData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to trigger backup');
    } finally {
      setBackingUpAll(false);
    }
  };

  const handleRestore = async (dashboardGuid: string, snapshotId: string) => {
    if (!currentOrg) return;
    if (!confirm('Are you sure you want to restore this dashboard? This will overwrite the current version.')) {
      return;
    }

    setRestoring(snapshotId);
    try {
      await restoreDashboard(currentOrg.orgId, dashboardGuid, snapshotId);
      alert('Restore initiated! The dashboard will be updated shortly.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore dashboard');
    } finally {
      setRestoring(null);
    }
  };

  const totalStorageBytes = recentBackups.reduce((sum, b) => sum + b.sizeBytes, 0);
  const storageDisplay =
    totalStorageBytes > 1024 * 1024
      ? `${(totalStorageBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${(totalStorageBytes / 1024).toFixed(0)} KB`;

  if (authLoading || orgLoading || loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (orgError || !currentOrg) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64">
          <p className="text-red-600 mb-4">{orgError || 'Unable to load organization'}</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Dashboards</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{dashboards.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Backups</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {dashboards.reduce((sum, d) => sum + d.backupCount, 0)}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">API Keys</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{apiKeys.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">Storage Used</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">{storageDisplay}</div>
        </div>
      </div>

      {/* No API Keys Warning */}
      {apiKeys.length === 0 && (
        <div className="mb-8 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex">
            <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                No API Keys Configured
              </h3>
              <p className="mt-1 text-sm text-yellow-700 dark:text-yellow-300">
                Add a New Relic API key to start backing up your dashboards.{' '}
                <Link href="/dashboard/apikeys" className="font-medium underline hover:text-yellow-600">
                  Add API Key
                </Link>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dashboards List */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg mb-8">
        <div className="px-4 py-5 sm:px-6 flex justify-between items-center border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Your Dashboards</h2>
          <button
            onClick={handleBackupAll}
            disabled={backingUpAll || dashboards.length === 0}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {backingUpAll ? 'Backing up...' : 'Backup All'}
          </button>
        </div>

        {dashboards.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No dashboards found</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {apiKeys.length === 0
                ? 'Add an API key to discover your New Relic dashboards.'
                : 'No dashboards found for your connected accounts.'}
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Account
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Pages
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Backups
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Last Backup
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {dashboards.map((dashboard) => (
                <tr key={dashboard.guid}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {dashboard.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {dashboard.accountId}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {dashboard.pageCount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {dashboard.backupCount}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {dashboard.lastBackup
                      ? new Date(dashboard.lastBackup).toLocaleDateString()
                      : 'Never'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => handleBackupSingle(dashboard.guid)}
                      disabled={backingUp === dashboard.guid}
                      className="text-blue-600 hover:text-blue-900 dark:text-blue-400 mr-4 disabled:opacity-50"
                    >
                      {backingUp === dashboard.guid ? 'Backing up...' : 'Backup'}
                    </button>
                    <Link
                      href={`/dashboard/backups?guid=${dashboard.guid}`}
                      className="text-green-600 hover:text-green-900 dark:text-green-400"
                    >
                      History
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Backups */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">Recent Backups</h2>
          <Link
            href="/dashboard/backups"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all
          </Link>
        </div>

        {recentBackups.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No backups yet</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Trigger a backup to start protecting your dashboards.
            </p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Dashboard
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Version
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {recentBackups.map((backup) => (
                <tr key={backup.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {backup.dashboardName}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    v{backup.version}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {new Date(backup.createdAt).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        backup.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : backup.status === 'FAILED'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}
                    >
                      {backup.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => handleRestore(backup.dashboardGuid, backup.id)}
                      disabled={restoring === backup.id || backup.status !== 'COMPLETED'}
                      className="text-green-600 hover:text-green-900 dark:text-green-400 disabled:opacity-50"
                    >
                      {restoring === backup.id ? 'Restoring...' : 'Restore'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </DashboardLayout>
  );
}
