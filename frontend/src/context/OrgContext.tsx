'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Organization, getOrganizations, createOrganization } from '@/lib/api-client';
import { useAuth } from './AuthContext';

interface OrgContextType {
  organizations: Organization[];
  currentOrg: Organization | null;
  loading: boolean;
  error: string | null;
  setCurrentOrg: (org: Organization) => void;
  refreshOrganizations: () => Promise<void>;
  createNewOrganization: (name: string) => Promise<Organization>;
}

const OrgContext = createContext<OrgContextType | undefined>(undefined);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshOrganizations = async () => {
    if (!user) {
      setOrganizations([]);
      setCurrentOrg(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const orgs = await getOrganizations();

      // If no orgs exist, create a default one
      if (orgs.length === 0) {
        console.log('No organizations found, creating default...');
        const newOrg = await createOrganization('My Organization');
        setOrganizations([newOrg]);
        setCurrentOrg(newOrg);
        return;
      }

      setOrganizations(orgs);

      // Set current org to first one if not set
      if (!currentOrg) {
        const savedOrgId = localStorage.getItem('currentOrgId');
        const savedOrg = orgs.find(o => o.orgId === savedOrgId);
        setCurrentOrg(savedOrg || orgs[0]);
      }
    } catch (err) {
      // If API fails, try to create a default organization
      console.warn('Failed to fetch organizations:', err);
      try {
        console.log('Creating default organization...');
        const newOrg = await createOrganization('My Organization');
        setOrganizations([newOrg]);
        setCurrentOrg(newOrg);
      } catch (createErr) {
        // If creation fails too, show error state
        console.error('Failed to create default organization:', createErr);
        setError('Unable to load or create organization. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshOrganizations();
  }, [user]);

  const handleSetCurrentOrg = (org: Organization) => {
    setCurrentOrg(org);
    localStorage.setItem('currentOrgId', org.orgId);
  };

  const createNewOrganization = async (name: string): Promise<Organization> => {
    const org = await createOrganization(name);
    await refreshOrganizations();
    return org;
  };

  return (
    <OrgContext.Provider
      value={{
        organizations,
        currentOrg,
        loading,
        error,
        setCurrentOrg: handleSetCurrentOrg,
        refreshOrganizations,
        createNewOrganization,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const context = useContext(OrgContext);
  if (context === undefined) {
    throw new Error('useOrg must be used within an OrgProvider');
  }
  return context;
}
