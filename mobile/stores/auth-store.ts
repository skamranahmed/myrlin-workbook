/**
 * auth-store.ts - Zustand store for biometric lock state management.
 *
 * Manages two concerns:
 * 1. biometricEnabled (persisted to MMKV): user preference for biometric lock
 * 2. isLocked (transient): whether the app is currently locked
 *
 * Pattern: Zustand 5 + persist middleware + MMKV synchronous storage.
 * Uses the same adapter pattern as theme-store.ts with a dedicated MMKV instance.
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';
import * as LocalAuthentication from 'expo-local-authentication';

/**
 * MMKV storage instance for auth/biometric persistence.
 * Dedicated instance keeps biometric prefs isolated from other stores.
 */
const storage: MMKV = createMMKV({ id: 'myrlin-auth' });

/**
 * Zustand-compatible synchronous storage adapter for MMKV.
 */
const mmkvStorage: StateStorage = {
  /** Read a string value from MMKV */
  getItem: (name: string): string | null => {
    return storage.getString(name) ?? null;
  },
  /** Write a string value to MMKV */
  setItem: (name: string, value: string): void => {
    storage.set(name, value);
  },
  /** Remove a key from MMKV */
  removeItem: (name: string): void => {
    storage.remove(name);
  },
};

/** Store state shape */
interface AuthStoreState {
  /** Whether the user has enabled biometric lock (persisted) */
  biometricEnabled: boolean;
  /** Whether the app is currently locked (transient, starts false) */
  isLocked: boolean;
}

/** Store actions */
interface AuthStoreActions {
  /**
   * Toggle biometric lock preference.
   * When enabling, checks for hardware and enrollment first.
   * @param enabled - Whether to enable biometric lock
   * @returns true if the preference was set, false if hardware is unavailable
   */
  setBiometricEnabled: (enabled: boolean) => Promise<boolean>;
  /** Lock the app (call when backgrounding) */
  lock: () => void;
  /** Unlock the app (call after successful biometric auth) */
  unlock: () => void;
}

/**
 * Auth store hook with MMKV-backed persistence for biometric preference.
 *
 * Usage:
 * ```ts
 * const { biometricEnabled, isLocked, setBiometricEnabled, lock, unlock } = useAuthStore();
 * ```
 *
 * Only `biometricEnabled` is persisted. `isLocked` is transient and starts
 * as false on every app launch (the user must authenticate once on enable).
 */
export const useAuthStore = create<AuthStoreState & AuthStoreActions>()(
  persist(
    (set) => ({
      // State
      biometricEnabled: false,
      isLocked: false,

      // Actions

      /**
       * Enable or disable biometric lock.
       * When enabling, verifies hardware capability and enrollment.
       * Returns false without enabling if the device lacks biometric hardware
       * or the user has not enrolled any biometrics.
       */
      setBiometricEnabled: async (enabled: boolean): Promise<boolean> => {
        if (!enabled) {
          set({ biometricEnabled: false, isLocked: false });
          return true;
        }

        // Verify hardware and enrollment before enabling
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        if (!hasHardware) {
          return false;
        }

        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        if (!isEnrolled) {
          return false;
        }

        set({ biometricEnabled: true });
        return true;
      },

      /**
       * Lock the app. Called when the app moves to background
       * and biometricEnabled is true.
       */
      lock: () => {
        set({ isLocked: true });
      },

      /**
       * Unlock the app. Called after successful biometric authentication.
       */
      unlock: () => {
        set({ isLocked: false });
      },
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => mmkvStorage),

      /**
       * Only persist biometricEnabled. isLocked is transient
       * and always starts false on fresh app launch.
       */
      partialize: (state) => ({
        biometricEnabled: state.biometricEnabled,
      }),
    }
  )
);
