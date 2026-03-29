/**
 * usePush.ts - Hook that initializes push notifications and handles taps.
 *
 * On mount, configures Android notification channels and sets the
 * notification handler for foreground display. When the active server
 * changes, requests permission and registers the push token with the
 * server. On notification tap, navigates to the relevant screen
 * using expo-router deep links.
 *
 * Must be called once in the root layout component.
 */

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import type { Subscription } from 'expo-notifications';

import { useAPIClient } from '@/hooks/useAPIClient';
import { useServerStore } from '@/stores/server-store';
import {
  requestPushPermission,
  getExpoPushToken,
  configurePushChannels,
} from '@/services/push-service';
import type { PushNotificationData } from '@/types/api';

/**
 * usePushNotifications - Initialize push and handle notification events.
 *
 * Sets up three concerns:
 * 1. Android channel creation and foreground display handler (once on mount)
 * 2. Token registration with the active server (on server or connection change)
 * 3. Notification tap routing to the correct screen (always active)
 *
 * Also fires the global showToast for foreground notifications when
 * a `onForegroundNotification` callback is provided.
 *
 * @param onForegroundNotification - Optional callback when a notification
 *   arrives while the app is foregrounded (used for toast display)
 */
export function usePushNotifications(
  onForegroundNotification?: (title: string, body: string) => void
): void {
  const router = useRouter();
  const client = useAPIClient();
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const pushToken = useServerStore((s) => s.pushToken);
  const setPushToken = useServerStore((s) => s.setPushToken);

  /** Ref to track the previous server ID for unregistration */
  const prevServerIdRef = useRef<string | null>(null);

  /** Ref to store foreground callback to avoid stale closures */
  const foregroundCbRef = useRef(onForegroundNotification);
  foregroundCbRef.current = onForegroundNotification;

  // ─── Mount: Configure channels and notification handler ───
  useEffect(() => {
    configurePushChannels();

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }, []);

  // ─── Server change: Register/unregister push token ────────
  useEffect(() => {
    if (connectionStatus !== 'connected' || !activeServerId || !client) {
      return;
    }

    let cancelled = false;

    async function registerToken() {
      // If server switched and we had a previous token, best-effort unregister
      if (
        prevServerIdRef.current &&
        prevServerIdRef.current !== activeServerId &&
        pushToken
      ) {
        try {
          // Attempt unregister from old server (may fail if unreachable)
          await client!.unregisterPush(pushToken);
        } catch {
          // Best-effort; old server may be offline
        }
      }

      const granted = await requestPushPermission();
      if (!granted || cancelled) return;

      const token = await getExpoPushToken();
      if (!token || cancelled) return;

      setPushToken(token);
      prevServerIdRef.current = activeServerId;

      try {
        const platform = Platform.OS as 'ios' | 'android';
        await client!.registerPush({ deviceToken: token, platform });
      } catch (error) {
        console.warn('[usePush] Failed to register push token:', error);
      }
    }

    registerToken();

    return () => {
      cancelled = true;
    };
  }, [activeServerId, connectionStatus, client, pushToken, setPushToken]);

  // ─── Foreground notification listener ─────────────────────
  useEffect(() => {
    const subscription: Subscription =
      Notifications.addNotificationReceivedListener((notification) => {
        const title = notification.request.content.title ?? 'Myrlin';
        const body = notification.request.content.body ?? '';
        if (foregroundCbRef.current) {
          foregroundCbRef.current(title, body);
        }
      });

    return () => subscription.remove();
  }, []);

  // ─── Notification tap handler (deep link navigation) ──────
  useEffect(() => {
    const subscription: Subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content
          .data as PushNotificationData | undefined;

        if (!data || !data.type) return;

        switch (data.type) {
          case 'session':
            if (data.sessionId) {
              router.push(`/sessions/${data.sessionId}`);
            }
            break;
          case 'task':
            router.push('/data/tasks');
            break;
          case 'conflict':
            router.push('/more/conflicts');
            break;
        }
      });

    return () => subscription.remove();
  }, [router]);
}
