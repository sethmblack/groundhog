'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

interface Dashboard {
  guid: string;
  name: string;
  accountId: string;
  lastBackup?: string;
}

interface Backup {
  snapshotId: string;
  dashboardGuid: string;
  dashboardName: string;
  createdAt: string;
  status: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, signOut } = useAuth();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [recentBackups, setRecentBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/signin');
      return;
    }

    // Simulated data for demo
    setDashboards([
      { guid: 'dash-1', name: 'Production Overview', accountId: '12345', lastBackup: '2024-01-15' },
      { guid: 'dash-2', name: 'User Metrics', accountId: '12345', lastBackup: '2024-01-15' },
      { guid: 'dash-3', name: 'API Performance', accountId: '12346', lastBackup: '2024-01-14' },
    ]);
    setRecentBackups([
      { snapshotId: 'snap-1', dashboardGuid: 'dash-1', dashboardName: 'Production Overview', createdAt: '2024-01-15T10:00:00Z', status: 'COMPLETED' },
      { snapshotId: 'snap-2', dashboardGuid: 'dash-2', dashboardName: 'User Metrics', createdAt: '2024-01-15T09:30:00Z', status: 'COMPLETED' },
    ]);
    setLoading(false);
  }, [authLoading, user, router]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/auth/signin');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-xl font-bold text-gray-900">
                Groundhog
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/dashboard/apikeys" className="text-gray-600 hover:text-gray-900">
                API Keys
              </Link>
              <Link href="/dashboard/backups" className="text-gray-600 hover:text-gray-900">
                Backups
              </Link>
              <Link href="/dashboard/settings" className="text-gray-600 hover:text-gray-900">
                Settings
              </Link>
              <button onClick={handleSignOut} className="text-gray-600 hover:text-gray-900">
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-500">Total Dashboards</div>
              <div className="text-3xl font-bold text-gray-900">{dashboards.length}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-500">Total Backups</div>
              <div className="text-3xl font-bold text-gray-900">{recentBackups.length}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-500">API Keys</div>
              <div className="text-3xl font-bold text-gray-900">2</div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm text-gray-500">Storage Used</div>
              <div className="text-3xl font-bold text-gray-900">45 MB</div>
            </div>
          </div>

          {/* Dashboards List */}
          <div className="bg-white shadow rounded-lg mb-8">
            <div className="px-4 py-5 sm:px-6 flex justify-between items-center">
              <h2 className="text-lg font-medium text-gray-900">Your Dashboards</h2>
              <button className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                Backup All
              </button>
            </div>
            <div className="border-t border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Backup</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {dashboards.map((dashboard) => (
                    <tr key={dashboard.guid}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {dashboard.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {dashboard.accountId}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {dashboard.lastBackup || 'Never'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button className="text-blue-600 hover:text-blue-900 mr-4">Backup</button>
                        <button className="text-green-600 hover:text-green-900">History</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Backups */}
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:px-6">
              <h2 className="text-lg font-medium text-gray-900">Recent Backups</h2>
            </div>
            <div className="border-t border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dashboard</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentBackups.map((backup) => (
                    <tr key={backup.snapshotId}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {backup.dashboardName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(backup.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                          {backup.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button className="text-blue-600 hover:text-blue-900 mr-4">View</button>
                        <button className="text-green-600 hover:text-green-900">Restore</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
