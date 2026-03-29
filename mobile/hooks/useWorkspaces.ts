/**
 * useWorkspaces.ts - TanStack Query hooks for workspace and group data.
 *
 * Provides query hooks for fetching the workspace list and workspace groups,
 * plus mutation hooks for CRUD operations and reordering.
 * Query caches are invalidated by SSE events (workspace:*, group:*) via
 * the useSSE hook, providing real-time updates.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { Workspace } from '../types/api';

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

/**
 * useCreateWorkspace - Mutation hook for creating a new workspace.
 *
 * Calls the server createWorkspace endpoint and invalidates the
 * workspaces query cache on success.
 *
 * @returns TanStack mutation with mutate/mutateAsync for workspace creation
 */
export function useCreateWorkspace() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; description?: string; color?: string }) =>
      client!.createWorkspace(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

/**
 * useUpdateWorkspace - Mutation hook for updating an existing workspace.
 *
 * Accepts a workspace ID and partial update data. Invalidates the
 * workspaces query cache on success.
 *
 * @returns TanStack mutation with mutate/mutateAsync for workspace updates
 */
export function useUpdateWorkspace() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Workspace> }) =>
      client!.updateWorkspace(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

/**
 * useDeleteWorkspace - Mutation hook for deleting a workspace.
 *
 * Calls the server deleteWorkspace endpoint and invalidates the
 * workspaces and groups query caches on success.
 *
 * @returns TanStack mutation with mutate/mutateAsync for workspace deletion
 */
export function useDeleteWorkspace() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.deleteWorkspace(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

/**
 * useReorderWorkspaces - Mutation hook for reordering workspaces.
 *
 * Accepts an array of workspace IDs in the desired order and
 * sends it to the server. Invalidates the workspaces cache on success.
 *
 * @returns TanStack mutation with mutate/mutateAsync for workspace reordering
 */
export function useReorderWorkspaces() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: string[]) => client!.reorderWorkspaces(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}
