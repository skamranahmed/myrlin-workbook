/**
 * useSessions.ts - TanStack Query hooks for session data and mutations.
 *
 * Provides query hooks for fetching session lists and individual sessions,
 * plus mutation hooks for session lifecycle operations (start, stop, restart,
 * create, update, delete). All mutations invalidate the sessions query cache
 * on success so the list re-renders with fresh data.
 *
 * SSE events also invalidate these same query keys, providing real-time updates
 * without manual refetch calls.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { Session, CreateSessionInput } from '@/types/api';

/**
 * useSessions - Fetch the session list with optional mode and filters.
 *
 * @param mode - View mode: "all", "workspace", or "recent"
 * @param params - Optional filters (workspaceId, count)
 * @returns TanStack Query result with sessions data
 *
 * @example
 * ```ts
 * const { data, isLoading, refetch } = useSessions('workspace', { workspaceId: 'abc' });
 * ```
 */
export function useSessions(
  mode: 'all' | 'workspace' | 'recent' = 'all',
  params?: { workspaceId?: string; count?: number }
) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['sessions', mode, params],
    queryFn: () => client!.getSessions(mode, params),
    enabled: !!client,
    staleTime: 5000,
  });
}

/**
 * useSession - Fetch a single session by ID.
 *
 * Uses the sessions list endpoint and filters client-side.
 *
 * @param id - Session ID to fetch
 * @returns TanStack Query result with the session
 */
export function useSession(id: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['session', id],
    queryFn: () => client!.getSession(id),
    enabled: !!client && !!id,
    staleTime: 5000,
  });
}

/**
 * useStartSession - Mutation to start a stopped session.
 *
 * Invalidates the sessions cache on success so the list
 * reflects the new running status.
 *
 * @returns TanStack mutation object
 */
export function useStartSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.startSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * useStopSession - Mutation to stop a running session.
 *
 * Invalidates the sessions cache on success.
 *
 * @returns TanStack mutation object
 */
export function useStopSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.stopSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * useRestartSession - Mutation to restart a session.
 *
 * Invalidates the sessions cache on success.
 *
 * @returns TanStack mutation object
 */
export function useRestartSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.restartSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * useDeleteSession - Mutation to delete (hide) a session.
 *
 * Invalidates the sessions cache on success.
 *
 * @returns TanStack mutation object
 */
export function useDeleteSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

/**
 * useUpdateSession - Mutation to update session fields (rename, move, tags).
 *
 * Invalidates both the sessions list and the specific session cache.
 *
 * @returns TanStack mutation object
 */
export function useUpdateSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Session> }) =>
      client!.updateSession(id, data),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({
        queryKey: ['session', variables.id],
      });
    },
  });
}

/**
 * useCreateSession - Mutation to create a new session.
 *
 * Invalidates the sessions cache on success.
 *
 * @returns TanStack mutation object
 */
export function useCreateSession() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSessionInput) => client!.createSession(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
