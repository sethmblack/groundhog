'use client';

import { useState, useEffect, Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useOrg } from '@/context/OrgContext';
import {
  BackupSnapshot,
  ApiKey,
  getBackupsPaginated,
  getBackupContent,
  restoreDashboard,
  triggerBackup,
  getApiKeys,
  PaginatedBackupResponse,
} from '@/lib/api-client';

const ITEMS_PER_PAGE = 50;

function BackupsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedGuid = searchParams.get('guid');
  const { user, loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading, error: orgError } = useOrg();

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [backupsResponse, setBackupsResponse] = useState<PaginatedBackupResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // UI state
  const [restoring, setRestoring] = useState<string | null>(null);
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<BackupSnapshot | null>(null);
  const [targetAccountId, setTargetAccountId] = useState('');
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingBackup, setViewingBackup] = useState<BackupSnapshot | null>(null);
  const [backupContent, setBackupContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Backup now modal state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('');
  const [backupInProgress, setBackupInProgress] = useState(false);

  // Sort state
  type SortField = 'dashboardName' | 'updatedAt' | 'sizeBytes';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handle URL parameter for dashboard filter
  useEffect(() => {
    if (selectedGuid) {
      setSearchQuery(selectedGuid);
    }
  }, [selectedGuid]);

  // Auth check
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin');
    }
  }, [authLoading, user, router]);

  // Fetch backups when page, search, or org changes
  const fetchBackups = useCallback(async () => {
    if (!currentOrg) return;
    setLoading(true);

    try {
      const response = await getBackupsPaginated(
        currentOrg.orgId,
        currentPage,
        ITEMS_PER_PAGE,
        debouncedSearch || undefined
      );
      setBackupsResponse(response);
    } catch (err) {
      console.error('Failed to fetch backups:', err);
      setBackupsResponse(null);
    } finally {
      setLoading(false);
    }
  }, [currentOrg, currentPage, debouncedSearch]);

  useEffect(() => {
    if (currentOrg) {
      fetchBackups();
      // Fetch API keys for backup modal
      getApiKeys(currentOrg.orgId)
        .then((keys) => {
          setApiKeys(keys);
          if (keys.length > 0) {
            setSelectedApiKeyId(keys[0].apiKeyId);
          }
        })
        .catch((err) => console.error('Failed to fetch API keys:', err));
    }
  }, [currentOrg, fetchBackups]);

  const handleRestoreClick = (backup: BackupSnapshot) => {
    setSelectedBackup(backup);
    setTargetAccountId('');
    setShowRestoreModal(true);
  };

  const handleRestore = async () => {
    if (!currentOrg || !selectedBackup) return;

    setRestoring(selectedBackup.id);
    setShowRestoreModal(false);

    try {
      await restoreDashboard(
        currentOrg.orgId,
        selectedBackup.dashboardGuid,
        selectedBackup.id,
        targetAccountId || undefined
      );
      alert('Restore initiated successfully! The dashboard will be updated shortly.');
      await fetchBackups();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to restore dashboard');
    } finally {
      setRestoring(null);
      setSelectedBackup(null);
    }
  };

  const handleBackupNowClick = () => {
    if (apiKeys.length === 0) {
      alert('No API keys configured. Please add an API key first.');
      router.push('/dashboard/apikeys');
      return;
    }
    setShowBackupModal(true);
  };

  const handleBackupNow = () => {
    if (!currentOrg || !selectedApiKeyId) return;

    // Close modal immediately and show notification
    setShowBackupModal(false);
    alert('Backup started! This may take several minutes. Refresh the page to see new backups.');

    // Fire and forget - don't block UI
    triggerBackup(currentOrg.orgId, selectedApiKeyId)
      .then((result) => {
        alert(`Backup completed! ${result.resultsCount} dashboard(s) backed up.`);
        fetchBackups();
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
          // Timeout is expected for large backups - they continue running
          console.log('Backup request timed out, but backup continues in background');
        } else {
          alert(`Backup error: ${errorMessage}`);
        }
      });
  };

  const handleView = async (backup: BackupSnapshot) => {
    if (!currentOrg) return;

    setViewingBackup(backup);
    setShowViewModal(true);
    setLoadingContent(true);
    setBackupContent(null);

    try {
      const content = await getBackupContent(currentOrg.orgId, backup.id);
      setBackupContent(JSON.stringify(content, null, 2));
    } catch (err) {
      setBackupContent(`Error loading backup: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoadingContent(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const goToPage = (page: number) => {
    if (page < 1 || (backupsResponse && page > backupsResponse.pagination.totalPages)) return;
    setCurrentPage(page);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedBackups = useMemo(() => {
    const backups = backupsResponse?.data || [];
    return [...backups].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'dashboardName':
          comparison = a.dashboardName.localeCompare(b.dashboardName);
          break;
        case 'updatedAt':
          // Use updatedAt if available, fallback to createdAt
          const aDate = a.updatedAt || a.createdAt;
          const bDate = b.updatedAt || b.createdAt;
          comparison = new Date(aDate).getTime() - new Date(bDate).getTime();
          break;
        case 'sizeBytes':
          comparison = a.sizeBytes - b.sizeBytes;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [backupsResponse?.data, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <svg className="w-4 h-4 ml-1 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg className="w-4 h-4 ml-1 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-4 h-4 ml-1 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
    );
  };

  if (authLoading || orgLoading) {
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

  const backups = backupsResponse?.data || [];
  const pagination = backupsResponse?.pagination;

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Backups</h1>
        <button
          onClick={handleBackupNowClick}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Backup Now
        </button>
      </div>

      {/* Search */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-64">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Search Dashboards
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by dashboard name or GUID..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">Total Backups</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {pagination?.total?.toLocaleString() || '—'}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {debouncedSearch ? 'Matching Results' : 'Showing'}
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white">
            {pagination ? `${backups.length} of ${pagination.total.toLocaleString()}` : '—'}
          </div>
        </div>
      </div>

      {/* Backups Table */}
      <div className="bg-white dark:bg-gray-800 shadow rounded-lg flex flex-col" style={{ maxHeight: '600px' }}>
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex justify-between items-center">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            Backup History
            {debouncedSearch && pagination && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                (filtered: {pagination.total.toLocaleString()} results)
              </span>
            )}
          </h2>
          {loading && (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          )}
        </div>

        {backups.length === 0 && !loading ? (
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
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No backups found</h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {debouncedSearch
                ? 'No backups match your search query.'
                : 'Trigger a backup to start protecting your dashboards.'}
            </p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0">
                <tr>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('dashboardName')}
                  >
                    <div className="flex items-center">
                      Dashboard
                      <SortIcon field="dashboardName" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('updatedAt')}
                  >
                    <div className="flex items-center">
                      Last Updated
                      <SortIcon field="updatedAt" />
                    </div>
                  </th>
                  <th
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600"
                    onClick={() => handleSort('sizeBytes')}
                  >
                    <div className="flex items-center">
                      Size
                      <SortIcon field="sizeBytes" />
                    </div>
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
                {sortedBackups.map((backup) => (
                  <tr key={backup.id}>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-xs">
                        {backup.dashboardName}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate max-w-xs">
                        {backup.dashboardGuid}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 dark:text-white">
                        {new Date(backup.updatedAt || backup.createdAt).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(backup.updatedAt || backup.createdAt).toLocaleTimeString()}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                      {formatBytes(backup.sizeBytes)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${
                          backup.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : backup.status === 'FAILED'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                            : backup.status === 'IN_PROGRESS'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        }`}
                      >
                        {backup.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <button
                        onClick={() => handleRestoreClick(backup)}
                        disabled={restoring === backup.id || backup.status !== 'COMPLETED'}
                        className="text-green-600 hover:text-green-900 dark:text-green-400 disabled:opacity-50 mr-3"
                      >
                        {restoring === backup.id ? 'Restoring...' : 'Restore'}
                      </button>
                      <button
                        onClick={() => handleView(backup)}
                        className="text-gray-600 hover:text-gray-900 dark:text-gray-400"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Controls */}
        {pagination && (pagination.hasPrev || pagination.hasNext) && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Page {pagination.page}
              {pagination.hasNext ? '+' : ''}
            </div>
            <div className="flex gap-2">
              {pagination.hasPrev && (
                <button
                  onClick={() => goToPage(1)}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  First
                </button>
              )}
              <button
                onClick={() => goToPage(currentPage - 1)}
                disabled={!pagination.hasPrev}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                {currentPage}
              </span>
              <button
                onClick={() => goToPage(currentPage + 1)}
                disabled={!pagination.hasNext}
                className="px-3 py-1 text-sm border border-gray-300 dark:border-gray-500 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Restore Modal */}
      {showRestoreModal && selectedBackup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Restore Dashboard
            </h3>

            <div className="mb-4">
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                You are about to restore:
              </p>
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                <p className="font-medium text-gray-900 dark:text-white">
                  {selectedBackup.dashboardName}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Last updated: {new Date(selectedBackup.updatedAt || selectedBackup.createdAt).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Target Account ID (optional)
              </label>
              <input
                type="text"
                value={targetAccountId}
                onChange={(e) => setTargetAccountId(e.target.value)}
                placeholder="Leave empty to restore to original account"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Specify a different account ID to restore to another account.
              </p>
            </div>

            <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-6">
              <div className="flex">
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="ml-2 text-sm text-yellow-700 dark:text-yellow-300">
                  This will overwrite the current dashboard configuration. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowRestoreModal(false)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleRestore}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                Restore Dashboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Backup Modal */}
      {showViewModal && viewingBackup && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-4xl max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                Backup Details
              </h3>
              <button
                onClick={() => setShowViewModal(false)}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mb-4 bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="font-medium text-gray-900 dark:text-white">
                {viewingBackup.dashboardName}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Last updated: {new Date(viewingBackup.updatedAt || viewingBackup.createdAt).toLocaleString()} | {formatBytes(viewingBackup.sizeBytes)}
              </p>
            </div>

            <div className="flex-1 overflow-auto bg-gray-900 rounded-lg p-4">
              {loadingContent ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400"></div>
                </div>
              ) : (
                <pre className="text-sm text-green-400 font-mono whitespace-pre-wrap break-words">
                  {backupContent}
                </pre>
              )}
            </div>

            <div className="flex justify-end mt-4 space-x-3">
              <button
                onClick={() => {
                  if (backupContent) {
                    navigator.clipboard.writeText(backupContent);
                    alert('Copied to clipboard!');
                  }
                }}
                disabled={loadingContent || !backupContent}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50"
              >
                Copy JSON
              </button>
              <button
                onClick={() => setShowViewModal(false)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Now Modal */}
      {showBackupModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Backup Dashboards
            </h3>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Select API Key
              </label>
              <select
                value={selectedApiKeyId}
                onChange={(e) => setSelectedApiKeyId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {apiKeys.map((key) => (
                  <option key={key.apiKeyId} value={key.apiKeyId}>
                    {key.name} ({key.newRelicAccountIds.length} account{key.newRelicAccountIds.length !== 1 ? 's' : ''})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                All dashboards accessible by this API key will be backed up.
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowBackupModal(false)}
                disabled={backupInProgress}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleBackupNow}
                disabled={backupInProgress || !selectedApiKeyId}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
              >
                {backupInProgress && (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                )}
                {backupInProgress ? 'Backing up...' : 'Start Backup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export default function BackupsPage() {
  return (
    <Suspense
      fallback={
        <DashboardLayout>
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        </DashboardLayout>
      }
    >
      <BackupsContent />
    </Suspense>
  );
}
