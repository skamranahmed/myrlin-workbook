/**
 * useAPIClient.ts - Hook providing a configured API client for the active server.
 *
 * Returns a MyrlinAPIClient instance bound to the current active server's
 * URL and token. Returns null when no server is active or the token is empty.
 * Memoized so a new client is only created when the URL or token changes.
 *
 * Used by all TanStack Query hooks to make authenticated API requests.
 */

import { useMemo } from 'react';
import { useServerStore } from '@/stores/server-store';
import { createAPIClient, type MyrlinAPIClient } from '@/services/api-client';

/**
 * useAPIClient - Returns a configured API client for the active server.
 *
 * Returns null when no server is connected or the token is missing.
 * Query hooks should check for null and set `enabled: !!client`.
 *
 * @returns MyrlinAPIClient instance or null
 *
 * @example
 * ```ts
 * const client = useAPIClient();
 * if (client) {
 *   const sessions = await client.getSessions();
 * }
 * ```
 */
export function useAPIClient(): MyrlinAPIClient | null {
  const server = useServerStore((s) => s.getActiveServer());

  return useMemo(() => {
    if (!server || !server.token) return null;
    return createAPIClient(server.url, server.token);
  }, [server?.url, server?.token]);
}
