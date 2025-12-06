'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  signIn as amplifySignIn,
  signUp as amplifySignUp,
  signOut as amplifySignOut,
  confirmSignUp as amplifyConfirmSignUp,
  getCurrentUser,
  fetchAuthSession,
} from 'aws-amplify/auth';

interface User {
  userId: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, orgName: string) => Promise<void>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkUser();
  }, []);

  async function checkUser() {
    try {
      const currentUser = await getCurrentUser();
      setUser({
        userId: currentUser.userId,
        email: currentUser.signInDetails?.loginId || '',
      });
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string) {
    // Check if already signed in first
    try {
      const currentUser = await getCurrentUser();
      if (currentUser) {
        // Already signed in, just update state
        setUser({
          userId: currentUser.userId,
          email: currentUser.signInDetails?.loginId || email,
        });
        return;
      }
    } catch {
      // Not signed in, proceed with sign in
    }

    const result = await amplifySignIn({ username: email, password });
    if (result.isSignedIn) {
      await checkUser();
    }
  }

  async function signUp(email: string, password: string, orgName: string) {
    await amplifySignUp({
      username: email,
      password,
      options: {
        userAttributes: {
          email,
          'custom:orgIds': orgName,
        },
      },
    });
  }

  async function confirmSignUp(email: string, code: string) {
    await amplifyConfirmSignUp({ username: email, confirmationCode: code });
  }

  async function signOut() {
    await amplifySignOut();
    setUser(null);
  }

  async function getAccessToken(): Promise<string | null> {
    try {
      const session = await fetchAuthSession();
      return session.tokens?.accessToken?.toString() || null;
    } catch {
      return null;
    }
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, signIn, signUp, confirmSignUp, signOut, getAccessToken }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
