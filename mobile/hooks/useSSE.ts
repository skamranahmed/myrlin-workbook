/**
 * useSSE.ts - SSE-to-TanStack-Query bridge hook.
 *
 * Maps Server-Sent Events from the Myrlin server to TanStack Query
 * cache invalidations. SSE events NEVER mutate state directly; they
 * only mark queries as stale so TanStack Query refetches automatically.
 *
 * Should be called once at a top-level screen (e.g. sessions list).
 * Manages its own SSE connection lifecycle based on connection status.
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server-store';
import { SSEClient } from '@/services/sse-client';

/**
 * Maps SSE event types to the TanStack Query keys that should be invalidated.
 * Each event type maps to one or more query key arrays.
 */
const EVENT_TO_QUERY_KEYS: Record<string, string[][]> = {
  'session:created':    [['sessions']],
  'session:updated':    [['sessions']],
  'session:deleted':    [['sessions']],
  'session:log':        [['sessions']],
  'workspace:created':  [['workspaces']],
  'workspace:updated':  [['workspaces']],
  'workspace:deleted':  [['workspaces']],
  'workspaces:reordered': [['workspaces']],
  'group:created':      [['groups']],
  'group:updated':      [['groups']],
  'group:deleted':      [['groups']],
  'template:created':   [['templates']],
  'template:deleted':   [['templates']],
  'settings:updated':   [['settings']],
  'docs:updated':       [['docs']],
};

/**
 * useSSE - Connects to the server's SSE stream and invalidates query caches.
 *
 * Connects when the active server is connected and has a valid token.
 * Disconnects when the server changes, disconnects, or the component unmounts.
 *
 * For session events that include an ID in the payload, it also invalidates
 * the specific session query key ['session', id] for targeted refetch.
 *
 * Call this hook once per screen that needs real-time updates.
 * It is safe to call from multiple screens; each creates its own SSE connection.
 */
export function useSSE(): void {
  const queryClient = useQueryClient();
  const getActiveServer = useServerStore((s) => s.getActiveServer);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const clientRef = useRef<SSEClient | null>(null);

  useEffect(() => {
    const server = getActiveServer();
    if (!server || !server.token || connectionStatus !== 'connected') {
      clientRef.current?.disconnect();
      clientRef.current = null;
      return;
    }

    const sse = new SSEClient((event) => {
      // Invalidate mapped query keys for this event type
      const keys = EVENT_TO_QUERY_KEYS[event.type];
      if (keys) {
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }

      // For session events with a specific ID, also invalidate that session
      if (event.type.startsWith('session:') && event.data?.id) {
        queryClient.invalidateQueries({
          queryKey: ['session', event.data.id],
        });
      }
    });

    sse.connect(server.url, server.token);
    clientRef.current = sse;

    return () => {
      sse.disconnect();
      clientRef.current = null;
    };
  }, [connectionStatus, getActiveServer, queryClient]);
}
