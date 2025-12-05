'use client';

import { ReactNode, useEffect } from 'react';
import { configureAmplify } from '@/lib/amplify-config';
import { AuthProvider } from '@/context/AuthContext';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    configureAmplify();
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
