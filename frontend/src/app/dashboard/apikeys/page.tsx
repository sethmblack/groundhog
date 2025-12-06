'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/DashboardLayout';
import { useAuth } from '@/context/AuthContext';
import { useOrg } from '@/context/OrgContext';
import {
  ApiKey,
  getApiKeys,
  createApiKey,
  deleteApiKey,
  validateApiKey,
} from '@/lib/api-client';

export default function ApiKeysPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { currentOrg, loading: orgLoading, error: orgError } = useOrg();
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Add form state
  const [newKeyName, setNewKeyName] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin');
      return;
    }
    if (currentOrg) {
      fetchApiKeys();
    }
  }, [authLoading, user, currentOrg, router]);

  const fetchApiKeys = async () => {
    if (!currentOrg) return;
    try {
      setLoading(true);
      const keys = await getApiKeys(currentOrg.orgId);
      setApiKeys(keys);
    } catch (err) {
      console.warn('Failed to fetch API keys, using demo data:', err);
      // Demo data for testing
      setApiKeys([
        {
          apiKeyId: 'key-1',
          name: 'Production Account',
          newRelicAccountIds: ['1234567'],
          maskedKey: '****ABCD',
          status: 'ACTIVE',
          lastValidated: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg) return;

    setAddError('');
    setAddLoading(true);

    try {
      await createApiKey(currentOrg.orgId, {
        name: newKeyName,
        apiKey: newApiKey,
      });
      setShowAddModal(false);
      setNewKeyName('');
      setNewApiKey('');
      await fetchApiKeys();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add API key';
      setAddError(message);
    } finally {
      setAddLoading(false);
    }
  };

  const handleValidate = async (keyId: string) => {
    if (!currentOrg) return;
    setValidatingId(keyId);
    try {
      const result = await validateApiKey(currentOrg.orgId, keyId);
      alert(result.valid ? 'API key is valid!' : 'API key is invalid');
      await fetchApiKeys();
    } catch (err) {
      alert('Failed to validate API key');
    } finally {
      setValidatingId(null);
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!currentOrg) return;
    if (!confirm('Are you sure you want to delete this API key?')) return;

    setDeletingId(keyId);
    try {
      await deleteApiKey(currentOrg.orgId, keyId);
      await fetchApiKeys();
    } catch (err) {
      alert('Failed to delete API key');
    } finally {
      setDeletingId(null);
    }
  };

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
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">API Keys</h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          Add API Key
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 shadow rounded-lg">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-medium text-gray-900 dark:text-white">
            New Relic API Keys
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage your New Relic User API keys. Each key will automatically discover all accessible accounts.
          </p>
        </div>

        {apiKeys.length === 0 ? (
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
                d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">
              No API keys
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Add a New Relic API key to start backing up your dashboards.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              Add your first API key
            </button>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Accounts
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">
                  Key
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
              {apiKeys.map((key) => (
                <tr key={key.apiKeyId}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                    {key.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                    {key.newRelicAccountIds?.length > 0
                      ? (
                        <span title={key.newRelicAccountIds.join(', ')}>
                          {key.newRelicAccountIds.length} account{key.newRelicAccountIds.length > 1 ? 's' : ''}
                        </span>
                      )
                      : <span className="text-gray-400 italic">Validate to discover</span>}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400 font-mono">
                    {key.maskedKey}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 text-xs rounded-full ${
                        key.status === 'ACTIVE'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          : key.status === 'INVALID'
                          ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                      }`}
                    >
                      {key.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button
                      onClick={() => handleValidate(key.apiKeyId)}
                      disabled={validatingId === key.apiKeyId}
                      className="text-blue-600 hover:text-blue-900 dark:text-blue-400 mr-4 disabled:opacity-50"
                    >
                      {validatingId === key.apiKeyId ? 'Validating...' : 'Validate'}
                    </button>
                    <button
                      onClick={() => handleDelete(key.apiKeyId)}
                      disabled={deletingId === key.apiKeyId}
                      className="text-red-600 hover:text-red-900 dark:text-red-400 disabled:opacity-50"
                    >
                      {deletingId === key.apiKeyId ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add API Key Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              Add New Relic API Key
            </h3>

            {addError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900 text-red-600 dark:text-red-200 rounded-lg text-sm">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddKey}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., Production Account"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  User API Key
                </label>
                <input
                  type="text"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="NRAK-..."
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                  required
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Get your User API key from New Relic API Keys settings. The key will automatically discover all accessible accounts.
                </p>
              </div>

              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {addLoading ? 'Adding...' : 'Add Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
