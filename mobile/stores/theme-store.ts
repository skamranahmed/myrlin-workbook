/**
 * theme-store.ts - Zustand theme store with MMKV synchronous persistence.
 *
 * Persists only the themeId to MMKV storage; the full theme object is
 * reconstructed from tokens on hydration. This prevents flash of unstyled
 * content since MMKV reads are synchronous (unlike AsyncStorage).
 *
 * Pattern: Zustand 5 + persist middleware + MMKV storage adapter.
 */

import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';
import { themes, DEFAULT_THEME_ID } from '../theme/tokens';
import type { MyrlinTheme, ThemeId } from '../theme/types';

/**
 * MMKV storage instance for theme persistence.
 * Using a dedicated instance keeps theme data isolated.
 * createMMKV is the v4 factory (MMKV class is type-only in v4).
 */
const storage: MMKV = createMMKV({ id: 'myrlin-theme' });

/**
 * Zustand-compatible storage adapter for MMKV.
 * All operations are synchronous, enabling instant theme reads on app launch.
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
interface ThemeStoreState {
  /** Currently selected theme ID */
  themeId: ThemeId;
  /** Full resolved theme object (derived from themeId) */
  theme: MyrlinTheme;
}

/** Store actions */
interface ThemeStoreActions {
  /** Switch to a different theme by ID */
  setTheme: (id: ThemeId) => void;
}

/**
 * Resolves a theme ID to its full MyrlinTheme object.
 * Falls back to the default theme if the ID is not recognized.
 *
 * @param id - Theme identifier
 * @returns Full theme object
 */
function resolveTheme(id: ThemeId): MyrlinTheme {
  return themes[id] ?? themes[DEFAULT_THEME_ID];
}

/**
 * Theme store hook with MMKV-backed persistence.
 *
 * Usage:
 * ```ts
 * const { theme, themeId, setTheme } = useThemeStore();
 * ```
 *
 * Only `themeId` is persisted. The `theme` object is always derived
 * from the tokens, so it stays in sync with any theme token updates
 * across app versions.
 */
export const useThemeStore = create<ThemeStoreState & ThemeStoreActions>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME_ID,
      theme: resolveTheme(DEFAULT_THEME_ID),

      setTheme: (id: ThemeId) => {
        set({
          themeId: id,
          theme: resolveTheme(id),
        });
      },
    }),
    {
      name: 'theme-storage',
      storage: createJSONStorage(() => mmkvStorage),

      /**
       * Only persist themeId (not the full theme object).
       * Keeps storage small and allows theme tokens to update between app versions.
       */
      partialize: (state) => ({ themeId: state.themeId }),

      /**
       * On rehydration, reconstruct the full theme object from the persisted themeId.
       */
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state.theme = resolveTheme(state.themeId);
          }
        };
      },
    }
  )
);
