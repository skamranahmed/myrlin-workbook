/**
 * haptics.ts - Centralized haptic feedback utility for Myrlin Mobile.
 *
 * Wraps expo-haptics with convenience functions for different interaction
 * types. Respects the hapticFeedback setting from the settings store.
 * All functions are safe no-ops if expo-haptics is unavailable (e.g. on web).
 *
 * Usage:
 *   hapticImpact('light')    - button taps, card presses
 *   hapticSelection()        - toggles, chips, segment changes
 *   hapticNotification('success') - action confirmations, errors
 *   hapticTab()              - tab bar taps (alias for light impact)
 */

import * as Haptics from 'expo-haptics';
import { useSettingsStore } from '@/stores/settings-store';

/** Whether we have already logged a haptics-unavailable warning */
let warnedOnce = false;

/**
 * Check if haptic feedback is enabled in settings.
 * Reads directly from the Zustand store (outside React).
 *
 * @returns true if haptics should fire
 */
function isEnabled(): boolean {
  return useSettingsStore.getState().hapticFeedback;
}

/**
 * Safely execute a haptic function, catching errors on unsupported platforms.
 *
 * @param fn - Async haptic function to execute
 */
async function safeHaptic(fn: () => Promise<void>): Promise<void> {
  if (!isEnabled()) return;
  try {
    await fn();
  } catch (_err) {
    if (!warnedOnce) {
      console.warn('[haptics] expo-haptics not available on this platform');
      warnedOnce = true;
    }
  }
}

/**
 * Trigger an impact haptic. Use for button taps, card presses, and
 * other discrete touch interactions.
 *
 * @param style - Impact weight: 'light' (default taps), 'medium' (destructive),
 *   or 'heavy' (rare, strong confirmation)
 */
export function hapticImpact(
  style: 'light' | 'medium' | 'heavy' = 'medium'
): void {
  const mapping = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  };
  safeHaptic(() => Haptics.impactAsync(mapping[style]));
}

/**
 * Trigger a selection haptic. Use for toggles, chips, segment control
 * changes, and other selection-type interactions.
 */
export function hapticSelection(): void {
  safeHaptic(() => Haptics.selectionAsync());
}

/**
 * Trigger a notification haptic. Use for success confirmations,
 * warnings, and error feedback.
 *
 * @param type - Notification type: 'success', 'warning', or 'error'
 */
export function hapticNotification(
  type: 'success' | 'warning' | 'error' = 'success'
): void {
  const mapping = {
    success: Haptics.NotificationFeedbackType.Success,
    warning: Haptics.NotificationFeedbackType.Warning,
    error: Haptics.NotificationFeedbackType.Error,
  };
  safeHaptic(() => Haptics.notificationAsync(mapping[type]));
}

/**
 * Trigger a light impact haptic for tab bar taps.
 * Alias for hapticImpact('light') with a descriptive name.
 */
export function hapticTab(): void {
  hapticImpact('light');
}
