/**
 * useResources.ts - TanStack Query hooks for system resource monitoring.
 *
 * Provides a query hook for fetching system and per-session resource metrics
 * with auto-refresh every 10 seconds for live monitoring, plus a mutation
 * hook for killing processes by PID.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';

/**
 * useResources - Fetch system CPU/memory and per-session resource usage.
 *
 * Auto-refreshes every 10 seconds (refetchInterval) for live monitoring.
 * StaleTime of 5 seconds prevents redundant requests during rapid navigation.
 *
 * @returns TanStack Query result with ResourceMetrics data
 *
 * @example
 * ```ts
 * const { data, isLoading, refetch } = useResources();
 * console.log(data?.system.cpuUsage);
 * ```
 */
export function useResources() {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['resources'],
    queryFn: () => client!.getResources(),
    enabled: !!client,
    staleTime: 5000,
    refetchInterval: 10000,
  });
}

/**
 * useKillProcess - Mutation to terminate a process by PID.
 *
 * Invalidates both the resources and sessions query caches on success
 * since killing a process affects both resource stats and session status.
 *
 * @returns TanStack mutation object
 *
 * @example
 * ```ts
 * const killMutation = useKillProcess();
 * killMutation.mutate(12345);
 * ```
 */
export function useKillProcess() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pid: number) => client!.killProcess(pid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
