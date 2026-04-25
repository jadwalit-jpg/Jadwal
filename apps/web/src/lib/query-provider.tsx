'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data stays "fresh" for 2 minutes — no refetch at all during this window
            staleTime: 2 * 60 * 1000,
            // Keep unused cache in memory for 10 minutes after component unmounts
            gcTime: 10 * 60 * 1000,
            // Only retry once on failure (don't hammer the server)
            retry: 1,
            // Don't refetch just because user alt-tabbed back
            refetchOnWindowFocus: false,
            // Don't refetch when component remounts (tab switching)
            refetchOnMount: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
