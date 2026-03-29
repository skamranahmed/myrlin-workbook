/**
 * useTasks.ts - TanStack Query hooks for worktree task data and mutations.
 *
 * Provides query hooks for fetching task lists, PR status, and file changes,
 * plus mutation hooks for task CRUD, merge, reject, push, and PR creation.
 * All mutations invalidate the tasks query cache on success so the board
 * re-renders with fresh data.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { CreateTaskInput, WorktreeTask } from '@/types/api';

/**
 * useTasks - Fetch all worktree tasks, optionally filtered by workspace.
 *
 * @param workspaceId - Optional workspace ID filter
 * @returns TanStack Query result with tasks data
 */
export function useTasks(workspaceId?: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['tasks', workspaceId],
    queryFn: () => client!.getTasks(workspaceId),
    enabled: !!client,
    staleTime: 10000,
  });
}

/**
 * useCreateTask - Mutation to create a new worktree task.
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function useCreateTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTaskInput) => client!.createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * useUpdateTask - Mutation to update a worktree task (status, tags, blockers, etc.).
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function useUpdateTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorktreeTask> }) =>
      client!.updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * useDeleteTask - Mutation to delete a worktree task.
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function useDeleteTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.deleteTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * useMergeTask - Mutation to merge a task branch into its base branch.
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function useMergeTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.mergeTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * useRejectTask - Mutation to reject a task and clean up its branch.
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function useRejectTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.rejectTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * usePushTask - Mutation to push a task branch to remote.
 *
 * Invalidates the tasks cache on success.
 *
 * @returns TanStack mutation object
 */
export function usePushTask() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.pushTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * useCreatePR - Mutation to create a GitHub PR for a task.
 *
 * Does not invalidate task cache since PR status is queried separately.
 *
 * @returns TanStack mutation object
 */
export function useCreatePR() {
  const client = useAPIClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => client!.createTaskPR(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['task-pr', id] });
    },
  });
}

/**
 * useTaskPR - Fetch PR status for a worktree task.
 *
 * @param taskId - Task ID to check PR status for
 * @returns TanStack Query result with PR data or null
 */
export function useTaskPR(taskId: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['task-pr', taskId],
    queryFn: () => client!.getTaskPR(taskId),
    enabled: !!client && !!taskId,
    staleTime: 30000,
  });
}

/**
 * useTaskChanges - Fetch changed files and stats for a task branch.
 *
 * @param taskId - Task ID to get changes for
 * @returns TanStack Query result with files and line stats
 */
export function useTaskChanges(taskId: string) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['task-changes', taskId],
    queryFn: () => client!.getTaskChanges(taskId),
    enabled: !!client && !!taskId,
    staleTime: 30000,
  });
}
