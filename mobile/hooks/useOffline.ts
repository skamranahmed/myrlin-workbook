/**
 * useOffline.ts - Network state monitor with offline queue replay.
 *
 * Combines @react-native-community/netinfo for client-side network detection
 * with the server store's connection status. When the device transitions from
 * offline to online AND the server is reachable, replays any queued mutations.
 *
 * This hook should be called once at the tab layout level alongside
 * useConnectionHealth. It is additive; it does not replace health polling
 * but extends it with client-side network awareness.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useNetInfo } from '@react-native-community/netinfo';

import { useServerStore } from '@/stores/server-store';
import { replayQueue, getQueueLength } from '@/utils/offline';
import { showToast } from '@/hooks/useToast';

/**
 * Return type for the useOffline hook.
 * Provides network state and queue info to consuming components.
 */
interface UseOfflineResult {
  /** True when the device has no network connectivity */
  isOffline: boolean;
  /** Number of pending mutations in the offline queue */
  queueLength: number;
}

/**
 * useOffline - Monitors device network state and replays offline queue on reconnect.
 *
 * Reads NetInfo's isConnected and the server store's connectionStatus to determine
 * true offline state. When network returns AND the server connection is restored,
 * replays queued mutations and shows a toast with the sync result.
 *
 * Updates server store connectionStatus to 'disconnected' when NetInfo reports
 * no connectivity, but only if currently 'connected' (to avoid fighting health polling).
 *
 * @returns Object with isOffline boolean and current queueLength
 */
export function useOffline(): UseOfflineResult {
  const netInfo = useNetInfo();
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);
  const getActiveServer = useServerStore((s) => s.getActiveServer);

  const [queueLength, setQueueLength] = useState(() => getQueueLength());
  const wasOfflineRef = useRef(false);
  const isReplayingRef = useRef(false);

  // Determine offline state: no network OR server disconnected
  const isNetworkDown = netInfo.isConnected === false;
  const isOffline = isNetworkDown || connectionStatus === 'disconnected';

  // Track offline transitions
  useEffect(() => {
    if (isNetworkDown) {
      wasOfflineRef.current = true;
      // Only override to disconnected if currently connected,
      // so we do not fight the health polling or connecting state
      if (connectionStatus === 'connected') {
        setConnectionStatus('disconnected');
      }
    }
  }, [isNetworkDown, connectionStatus, setConnectionStatus]);

  /**
   * Attempt to replay the offline queue when connectivity is restored.
   * Guards against concurrent replay calls with a ref flag.
   */
  const tryReplay = useCallback(async () => {
    if (isReplayingRef.current) return;

    const server = getActiveServer();
    if (!server || !server.token) return;

    const pending = getQueueLength();
    if (pending === 0) return;

    isReplayingRef.current = true;
    try {
      const result = await replayQueue(server.url, server.token);
      const newLength = getQueueLength();
      setQueueLength(newLength);

      if (result.succeeded > 0) {
        const msg =
          result.succeeded === 1
            ? '1 queued action synced'
            : `${result.succeeded} queued actions synced`;
        showToast(msg, 'success');
      }
      if (result.failed > 0 && result.succeeded === 0) {
        showToast(`${result.failed} queued actions failed to sync`, 'warning');
      }
    } finally {
      isReplayingRef.current = false;
    }
  }, [getActiveServer]);

  // Replay queue when transitioning from offline to connected
  useEffect(() => {
    if (
      wasOfflineRef.current &&
      netInfo.isConnected === true &&
      connectionStatus === 'connected'
    ) {
      wasOfflineRef.current = false;
      tryReplay();
    }
  }, [netInfo.isConnected, connectionStatus, tryReplay]);

  // Periodically refresh queue length for UI display
  useEffect(() => {
    setQueueLength(getQueueLength());
  }, [isOffline]);

  return { isOffline, queueLength };
}
