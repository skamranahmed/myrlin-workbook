/**
 * useWorkspaces.ts - TanStack Query hooks for workspace and group data.
 *
 * Provides query hooks for fetching the workspace list and workspace groups.
 * These caches are invalidated by SSE events (workspace:*, group:*) via
 * the useSSE hook, providing real-time updates.
 */

import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';

/**
 * useWorkspaces - Fetch all workspaces and their ordering.
 *
 * @returns TanStack Query result with workspaces array and workspace order
 *
 * @example
 * ```ts
 * const { data, isLoading } = useWorkspaces();
 * const workspaces = data?.workspaces ?? [];
 * ```
 */
export function useWorkspaces() {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => client!.getWorkspaces(),
    enabled: !!client,
    staleTime: 10000,
  });
}

/**
 * useGroups - Fetch all workspace groups.
 *
 * @returns TanStack Query result with groups array
 *
 * @example
 * ```ts
 * const { data } = useGroups();
 * const groups = data?.groups ?? [];
 * ```
 */
export function useGroups() {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['groups'],
    queryFn: () => client!.getGroups(),
    enabled: !!client,
    staleTime: 10000,
  });
}
