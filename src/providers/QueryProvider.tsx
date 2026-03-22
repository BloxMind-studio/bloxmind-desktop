import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY, // SSE keeps data fresh
      gcTime: Number.POSITIVE_INFINITY,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export { queryClient };

export function QueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
