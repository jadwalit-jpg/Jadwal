'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

interface VendorProfile {
  id: string;
  businessNameEn: string;
  businessNameAr: string;
  slug: string;
  status: string;
  countryId: string;
}

interface User {
  id: string;
  email: string;
  fullName: string;
  phone?: string;
  role: 'CUSTOMER' | 'VENDOR' | 'ADMIN';
  vendor?: VendorProfile;
  // True when the user hasn't accepted the current Terms version (Google-OAuth
  // signups, pre-feature accounts, or after a Terms bump). Drives the one-time
  // post-login consent gate. From GET /auth/me.
  needsTermsAcceptance?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, pass: string) => Promise<User>;
  register: (fullName: string, email: string, password: string, phone?: string) => Promise<{ pending: true; email: string }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const LOGIN_PATHS = ['/admin/login', '/login', '/register'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const checkAuth = async () => {
    if (typeof window !== 'undefined' && LOGIN_PATHS.includes(pathname ?? '')) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await api.get('/auth/me', {
        validateStatus: (status) => status === 200 || status === 401,
      });
      if (res.status === 200) setUser(res.data);
      else setUser(null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  // Listen for session expiry from the API interceptor
  useEffect(() => {
    const handleExpired = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener('auth:session-expired', handleExpired);
    return () => window.removeEventListener('auth:session-expired', handleExpired);
  }, [queryClient]);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setUser(data);
    return data;
  };

  const register = async (fullName: string, email: string, password: string, phone?: string) => {
    // Returns { pending: true, email } — no session issued until email is verified
    const { data } = await api.post('/auth/register', { fullName, email, password, ...(phone ? { phone } : {}) });
    return data as { pending: true; email: string };
  };

  const logout = async () => {
    const currentRole = user?.role;
    try { await api.post('/auth/logout'); } catch { /* clear local state regardless */ }
    setUser(null);
    queryClient.clear();

    if (currentRole === 'ADMIN') {
      router.replace('/admin/login');
    } else if (currentRole === 'VENDOR') {
      router.replace('/login');
    } else {
      router.replace('/');
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, checkAuth }}>
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
