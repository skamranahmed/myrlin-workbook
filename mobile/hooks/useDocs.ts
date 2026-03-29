/**
 * useDocs.ts - TanStack Query hooks for workspace docs and features.
 *
 * Provides query hooks for fetching workspace documentation sections
 * (notes, goals, tasks, roadmap, rules) and feature board data.
 * Mutation hooks handle add, update, and delete operations with
 * automatic cache invalidation on success.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { DocSection, Feature } from '@/types/api';

/**
 * useWorkspaceDocs - Fetch all doc sections for a workspace.
 *
 * Returns notes, goals, tasks, roadmap, and rules arrays.
 *
 * @param workspaceId - Workspace ID to fetch docs for
 * @returns TanStack Query result with WorkspaceDocs
 */
export function useWorkspaceDocs(workspaceId: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['workspace-docs', workspaceId],
    queryFn: () => client!.getWorkspaceDocs(workspaceId),
    enabled: !!client && !!workspaceId,
    staleTime: 10000,
  });
}

/**
 * useAddDocItem - Mutation to add an item to a doc section.
 *
 * Invalidates the workspace-docs cache on success.
 *
 * @returns TanStack mutation for adding doc items
 */
export function useAddDocItem() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      section,
      item,
    }: {
      workspaceId: string;
      section: DocSection;
      item: Record<string, unknown>;
    }) => client!.addDocItem(workspaceId, section, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-docs'] });
    },
  });
}

/**
 * useUpdateDocItem - Mutation to update an item in a doc section.
 *
 * Invalidates the workspace-docs cache on success.
 *
 * @returns TanStack mutation for updating doc items
 */
export function useUpdateDocItem() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      section,
      index,
      item,
    }: {
      workspaceId: string;
      section: DocSection;
      index: number;
      item: Record<string, unknown>;
    }) => client!.updateDocItem(workspaceId, section, index, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-docs'] });
    },
  });
}

/**
 * useDeleteDocItem - Mutation to delete an item from a doc section.
 *
 * Invalidates the workspace-docs cache on success.
 *
 * @returns TanStack mutation for deleting doc items
 */
export function useDeleteDocItem() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      section,
      index,
    }: {
      workspaceId: string;
      section: DocSection;
      index: number;
    }) => client!.deleteDocItem(workspaceId, section, index),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-docs'] });
    },
  });
}

/**
 * useFeatures - Fetch all features for a workspace.
 *
 * @param workspaceId - Workspace ID to fetch features for
 * @returns TanStack Query result with Feature array
 */
export function useFeatures(workspaceId: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['features', workspaceId],
    queryFn: () => client!.getFeatures(workspaceId),
    enabled: !!client && !!workspaceId,
    staleTime: 10000,
  });
}

/**
 * useCreateFeature - Mutation to create a new feature.
 *
 * Invalidates the features cache on success.
 *
 * @returns TanStack mutation for creating features
 */
export function useCreateFeature() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      data,
    }: {
      workspaceId: string;
      data: {
        name: string;
        description?: string;
        status?: string;
        priority?: string;
      };
    }) => client!.createFeature(workspaceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });
}

/**
 * useUpdateFeature - Mutation to update an existing feature.
 *
 * Invalidates the features cache on success.
 *
 * @returns TanStack mutation for updating features
 */
export function useUpdateFeature() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Feature>;
    }) => client!.updateFeature(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });
}

/**
 * useDeleteFeature - Mutation to delete a feature.
 *
 * Invalidates the features cache on success.
 *
 * @returns TanStack mutation for deleting features
 */
export function useDeleteFeature() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.deleteFeature(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['features'] });
    },
  });
}
