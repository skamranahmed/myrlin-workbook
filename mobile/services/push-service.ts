/**
 * push-service.ts - Push notification setup and token acquisition.
 *
 * Handles Expo push notification permissions, token retrieval, and
 * Android notification channel configuration. Used by the usePush
 * hook to initialize push on app launch and server connection.
 */

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Request push notification permission from the user.
 * On physical devices, prompts the OS permission dialog.
 * On simulators, permissions are always denied.
 *
 * @returns Whether permission was granted
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    // Push notifications are not supported on simulators
    return false;
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') {
    return true;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Get the Expo push token for this device.
 * Requires that permission has already been granted.
 * Returns null if token retrieval fails (e.g. simulator, no network).
 *
 * @returns The Expo push token string, or null on failure
 */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: projectId ?? undefined,
    });
    return tokenData.data;
  } catch (error) {
    console.warn('[push-service] Failed to get push token:', error);
    return null;
  }
}

/**
 * Configure Android notification channels.
 * Creates a "session-events" channel with HIGH importance for
 * session completion, input needed, and conflict notifications.
 * No-op on iOS (channels are an Android-only concept).
 */
export async function configurePushChannels(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('session-events', {
      name: 'Session Events',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#89b4fa',
    });
  }
}
