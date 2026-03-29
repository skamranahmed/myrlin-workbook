/**
 * secure-storage-adapter.ts - SecureStore adapter for Zustand persist middleware.
 *
 * Wraps expo-secure-store in a Zustand-compatible StateStorage interface,
 * enabling encrypted persistence of sensitive data like auth tokens and
 * server connection details.
 *
 * Unlike MMKV (synchronous), SecureStore is async. Zustand's persist
 * middleware handles async storage adapters natively via createJSONStorage.
 */

import * as SecureStore from 'expo-secure-store';
import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * Zustand-compatible async storage adapter backed by expo-secure-store.
 * All values are stored encrypted on-device using the OS keychain.
 */
const secureStorage: StateStorage = {
  /**
   * Retrieve a value from SecureStore by key.
   * @param name - Storage key
   * @returns The stored value or null if not found
   */
  getItem: async (name: string): Promise<string | null> => {
    return SecureStore.getItemAsync(name);
  },

  /**
   * Store a value in SecureStore under the given key.
   * @param name - Storage key
   * @param value - Value to store (JSON string)
   */
  setItem: async (name: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(name, value);
  },

  /**
   * Remove a value from SecureStore by key.
   * @param name - Storage key to delete
   */
  removeItem: async (name: string): Promise<void> => {
    await SecureStore.deleteItemAsync(name);
  },
};

/**
 * Create a Zustand-compatible JSON storage backed by expo-secure-store.
 * Use this as the `storage` option in Zustand's persist middleware
 * for stores that contain sensitive data (tokens, server configs).
 *
 * @returns Zustand JSON storage adapter wrapping SecureStore
 *
 * @example
 * ```ts
 * persist(storeCreator, {
 *   name: 'my-secure-store',
 *   storage: createSecureStorage(),
 * })
 * ```
 */
export function createSecureStorage() {
  return createJSONStorage(() => secureStorage);
}
