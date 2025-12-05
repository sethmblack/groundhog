import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Groundhog - Dashboard Backup & Restore',
  description: 'New Relic Dashboard Backup & Restore SaaS Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
