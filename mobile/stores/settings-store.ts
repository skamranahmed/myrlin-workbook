/**
 * settings-store.ts - Zustand store for app settings with MMKV persistence.
 *
 * Manages notification level, haptic feedback, and confirm-before-close
 * preferences. Uses MMKV for synchronous reads (no flash of default state).
 *
 * Pattern: Zustand 5 + persist middleware + MMKV storage adapter
 * (same as theme-store.ts).
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';

/** Notification level options */
export type NotificationLevel = 'all' | 'errors' | 'none';

/**
 * MMKV storage instance for settings persistence.
 * Dedicated instance keeps settings data isolated from theme storage.
 */
const storage: MMKV = createMMKV({ id: 'myrlin-settings' });

/**
 * Zustand-compatible storage adapter for MMKV.
 * Synchronous operations enable instant reads on app launch.
 */
const mmkvStorage: StateStorage = {
  getItem: (name: string): string | null => {
    return storage.getString(name) ?? null;
  },
  setItem: (name: string, value: string): void => {
    storage.set(name, value);
  },
  removeItem: (name: string): void => {
    storage.remove(name);
  },
};

/** Store state shape */
interface SettingsStoreState {
  /** Which events trigger push notifications */
  notificationLevel: NotificationLevel;
  /** Whether haptic feedback is enabled for interactions */
  hapticFeedback: boolean;
  /** Whether to show confirmation before closing sessions */
  confirmBeforeClose: boolean;
}

/** Store actions */
interface SettingsStoreActions {
  /** Update the notification level preference */
  setNotificationLevel: (level: NotificationLevel) => void;
  /** Toggle haptic feedback on or off */
  setHapticFeedback: (enabled: boolean) => void;
  /** Toggle confirm-before-close on or off */
  setConfirmBeforeClose: (enabled: boolean) => void;
}

/**
 * Settings store hook with MMKV-backed persistence.
 *
 * Usage:
 * ```ts
 * const { notificationLevel, setNotificationLevel } = useSettingsStore();
 * const haptic = useSettingsStore(s => s.hapticFeedback);
 * ```
 *
 * All fields are persisted to MMKV and survive app restarts.
 */
export const useSettingsStore = create<SettingsStoreState & SettingsStoreActions>()(
  persist(
    (set) => ({
      // Defaults
      notificationLevel: 'all' as NotificationLevel,
      hapticFeedback: true,
      confirmBeforeClose: true,

      /**
       * Set the notification level preference.
       * @param level - 'all', 'errors', or 'none'
       */
      setNotificationLevel: (level: NotificationLevel) => {
        set({ notificationLevel: level });
      },

      /**
       * Enable or disable haptic feedback.
       * @param enabled - Whether haptics should fire on interactions
       */
      setHapticFeedback: (enabled: boolean) => {
        set({ hapticFeedback: enabled });
      },

      /**
       * Enable or disable the close confirmation dialog.
       * @param enabled - Whether to prompt before closing sessions
       */
      setConfirmBeforeClose: (enabled: boolean) => {
        set({ confirmBeforeClose: enabled });
      },
    }),
    {
      name: 'settings-storage',
      storage: createJSONStorage(() => mmkvStorage),
    }
  )
);
