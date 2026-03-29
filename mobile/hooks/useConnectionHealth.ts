/**
 * useConnectionHealth.ts - Connection health monitor with exponential backoff.
 *
 * Polls the active server's /api/auth/check endpoint at regular intervals.
 * On success, resets backoff to 5s. On failure, doubles the interval up to 60s.
 * Also monitors AppState transitions: immediate health check on foreground,
 * biometric lock on background (if enabled).
 *
 * This hook should be called once at the top level of the tab layout.
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useServerStore } from '@/stores/server-store';
import { useAuthStore } from '@/stores/auth-store';
import { createAPIClient } from '@/services/api-client';

/** Base polling interval in milliseconds */
const BASE_INTERVAL = 5000;

/** Maximum polling interval in milliseconds */
const MAX_INTERVAL = 60000;

/**
 * useConnectionHealth - Monitors server connectivity with exponential backoff.
 *
 * Reads the active server from useServerStore and periodically calls checkAuth().
 * Updates connectionStatus based on the result:
 * - authenticated=true: 'connected', reset backoff
 * - authenticated=false: 'token-expired'
 * - network error: 'disconnected', double backoff
 *
 * Also handles AppState transitions:
 * - Foreground: immediate health check
 * - Background: locks app if biometric is enabled
 */
export function useConnectionHealth(): void {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const getActiveServer = useServerStore((s) => s.getActiveServer);
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);

  // Refs to avoid re-creating effects on every render
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(BASE_INTERVAL);
  const appStateRef = useRef(AppState.currentState);

  /**
   * Run a single health check against the active server.
   * Updates connection status and adjusts backoff accordingly.
   */
  const checkHealth = useCallback(async () => {
    const server = getActiveServer();
    if (!server || !server.token) {
      setConnectionStatus('disconnected');
      return;
    }

    try {
      const client = createAPIClient(server.url, server.token);
      const result = await client.checkAuth();

      if (result.authenticated) {
        setConnectionStatus('connected');
        backoffRef.current = BASE_INTERVAL;
      } else {
        setConnectionStatus('token-expired');
      }
    } catch {
      setConnectionStatus('disconnected');
      // Exponential backoff: double interval up to MAX
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_INTERVAL);
    }
  }, [getActiveServer, setConnectionStatus]);

  /**
   * Schedule the next health check after the current backoff interval.
   * Returns the timeout handle for cleanup.
   */
  const scheduleNext = useCallback(() => {
    intervalRef.current = setTimeout(async () => {
      await checkHealth();
      scheduleNext();
    }, backoffRef.current);
  }, [checkHealth]);

  // Main polling effect: starts when activeServerId changes
  useEffect(() => {
    if (!activeServerId) {
      return;
    }

    // Reset backoff on server change
    backoffRef.current = BASE_INTERVAL;

    // Immediate first check
    checkHealth().then(() => {
      scheduleNext();
    });

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeServerId, checkHealth, scheduleNext]);

  // AppState listener: foreground triggers immediate check, background locks
  useEffect(() => {
    /**
     * Handle app state transitions.
     * - active (foreground): cancel pending timer, check immediately, reschedule
     * - background/inactive: lock the app if biometric is enabled
     */
    const handleAppState = (nextState: AppStateStatus) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active' && previous !== 'active') {
        // Coming to foreground: immediate health check
        if (intervalRef.current) {
          clearTimeout(intervalRef.current);
          intervalRef.current = null;
        }
        backoffRef.current = BASE_INTERVAL;
        checkHealth().then(() => {
          scheduleNext();
        });
      }

      if (
        (nextState === 'background' || nextState === 'inactive') &&
        previous === 'active'
      ) {
        // Going to background: lock if biometric is enabled
        if (biometricEnabled) {
          useAuthStore.getState().lock();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => {
      subscription.remove();
    };
  }, [biometricEnabled, checkHealth, scheduleNext]);
}
