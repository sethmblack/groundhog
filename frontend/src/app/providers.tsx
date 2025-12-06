'use client';

import { ReactNode } from 'react';
import { configureAmplify } from '@/lib/amplify-config';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { OrgProvider } from '@/context/OrgContext';

// Configure Amplify synchronously BEFORE any components render
// This ensures auth session is available when AuthProvider mounts
configureAmplify();

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <OrgProvider>{children}</OrgProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
