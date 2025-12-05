'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function Home() {
  const [isLoggedIn] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-900 mb-4">Groundhog</h1>
        <p className="text-xl text-gray-600 mb-8">
          New Relic Dashboard Backup & Restore
        </p>

        {!isLoggedIn ? (
          <div className="space-x-4">
            <Link
              href="/auth/signin"
              className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="inline-block bg-gray-200 text-gray-800 px-6 py-3 rounded-lg hover:bg-gray-300 transition"
            >
              Sign Up
            </Link>
          </div>
        ) : (
          <Link
            href="/dashboard"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition"
          >
            Go to Dashboard
          </Link>
        )}
      </div>

      <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Automated Backups
          </h3>
          <p className="text-gray-600">
            Schedule daily backups of all your New Relic dashboards automatically.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Version History
          </h3>
          <p className="text-gray-600">
            Access complete version history and restore any previous state.
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            Multi-Account
          </h3>
          <p className="text-gray-600">
            Connect multiple New Relic accounts per organization.
          </p>
        </div>
      </div>
    </main>
  );
}
