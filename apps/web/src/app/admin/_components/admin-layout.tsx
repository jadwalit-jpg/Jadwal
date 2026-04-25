'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/context/auth-context';
import { useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { AdminSidebar } from './admin-sidebar';
import NotificationBell from '@/components/notification-bell';
import { Search, Users, Store, CalendarRange, BookOpen, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';

function AdminLayoutSkeleton() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit">
      <aside className="fixed start-0 top-0 z-20 h-full w-64 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-e border-gray-200/80 dark:border-slate-800/80 flex flex-col">
        <div className="px-6 pt-8 pb-6">
          <div className="h-7 w-32 bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse" />
          <div className="h-3 w-24 bg-gray-100 dark:bg-slate-800 rounded mt-2 animate-pulse" />
        </div>
        <div className="px-3 space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </aside>
      <div className="ms-64 min-h-screen">
        <header className="sticky top-0 z-10 flex items-center justify-between px-8 py-4 bg-white/80 dark:bg-slate-950/80 backdrop-blur border-b border-gray-200 dark:border-slate-800">
          <div className="h-6 w-40 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
          <div className="flex items-center gap-3">
            <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-slate-700 animate-pulse" />
          </div>
        </header>
        <div className="p-8">
          <div className="h-8 w-48 bg-gray-200 dark:bg-slate-700 rounded animate-pulse mb-6" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 bg-gray-100 dark:bg-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SearchResult {
  users: { id: string; fullName: string; email: string; role: string }[];
  vendors: { id: string; businessNameEn: string; status: string }[];
  activities: { id: string; titleEn: string; status: string }[];
  bookings: { id: string; ref: string; status: string }[];
}

const entityIcons: Record<string, React.ElementType> = {
  users: Users,
  vendors: Store,
  activities: CalendarRange,
  bookings: BookOpen,
};

const entityLinks: Record<string, string> = {
  users: '/admin/users',
  vendors: '/admin/vendors',
  activities: '/admin/activities',
  bookings: '/admin/bookings',
};

interface AdminLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export default function AdminLayout({ children, title, subtitle }: AdminLayoutProps) {
  const { user, logout, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [debouncedQuery, setDebouncedQuery] = useState('');

  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(val), 300);
  }, []);

  const { data: searchResults } = useQuery<SearchResult>({
    queryKey: ['admin', 'search', debouncedQuery],
    queryFn: async () => {
      const { data } = await api.get(`/admin/search?q=${encodeURIComponent(debouncedQuery)}`);
      return data;
    },
    enabled: debouncedQuery.length >= 2,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading) return <AdminLayoutSkeleton />;

  const handleLogout = async () => {
    await logout();
  };

  const hasResults = searchResults && (searchResults.users.length > 0 || searchResults.vendors.length > 0 || searchResults.activities.length > 0 || searchResults.bookings.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 font-outfit text-gray-900 dark:text-white">
      <AdminSidebar onLogout={handleLogout} />

      <div className="ms-64 min-h-screen">
        {/* Top bar */}
        <header className="sticky top-0 z-10 flex items-center justify-between px-8 py-4 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-gray-200/80 dark:border-slate-800/80">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-3">
            {/* Global Search */}
            <div className="relative" ref={searchRef}>
              <button
                type="button"
                onClick={() => setSearchOpen(!searchOpen)}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-all"
                aria-label="Search"
              >
                <Search className="h-4.5 w-4.5 text-gray-500 dark:text-slate-400" />
              </button>
              {searchOpen && (
                <div className="absolute end-0 top-full mt-2 w-96 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-xl overflow-hidden">
                  <div className="p-3 border-b border-gray-100 dark:border-slate-800">
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search users, vendors, activities..."
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        autoFocus
                        className="w-full ps-10 pe-4 py-2 bg-gray-50 dark:bg-slate-800/60 border-0 rounded-xl text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-slate-500 outline-none"
                      />
                    </div>
                  </div>
                  {debouncedQuery.length >= 2 && (
                    <div className="max-h-80 overflow-y-auto p-2">
                      {!hasResults && (
                        <p className="text-sm text-gray-400 dark:text-slate-500 text-center py-6">No results found</p>
                      )}
                      {searchResults && (['users', 'vendors', 'activities', 'bookings'] as const).map((entity) => {
                        const items = searchResults[entity];
                        if (items.length === 0) return null;
                        const Icon = entityIcons[entity];
                        return (
                          <div key={entity} className="mb-2">
                            <p className="text-[10px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider px-2 py-1">{entity}</p>
                            {items.map((item: any) => (
                              <Link
                                key={item.id}
                                href={entityLinks[entity]}
                                onClick={() => setSearchOpen(false)}
                                className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
                              >
                                <Icon className="h-4 w-4 text-gray-400 dark:text-slate-500 flex-shrink-0" />
                                <span className="text-sm text-gray-700 dark:text-slate-300 truncate">
                                  {item.fullName || item.businessNameEn || item.titleEn || item.ref}
                                </span>
                                <span className="ms-auto text-[10px] font-medium text-gray-400 dark:text-slate-500 uppercase">
                                  {item.status || item.role}
                                </span>
                              </Link>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Notifications Bell */}
            <NotificationBell />

            {/* View Site — target=_blank MUST have rel=noopener noreferrer
                to prevent window.opener access from the opened tab (classic
                reverse-tabnabbing vector). */}
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-gray-500 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View Site
            </Link>

            <div className="w-px h-6 bg-gray-200 dark:bg-slate-800" />

            <span className="text-sm text-gray-500 dark:text-slate-400">{user?.fullName}</span>
            <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white text-sm shadow-lg shadow-blue-500/20">
              {user?.fullName?.charAt(0)?.toUpperCase()}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-8">
          {subtitle && (
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
