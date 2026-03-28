/**
 * useTheme.ts - Theme context provider and consumer hook.
 *
 * ThemeProvider wraps the component tree with the current theme from the
 * Zustand store. useTheme() reads the theme from React context for
 * efficient re-renders (only components that call useTheme re-render
 * on theme changes).
 *
 * Pattern: React Context + Zustand store (design doc Pattern 3).
 */

import React, { createContext, useContext, useMemo } from 'react';
import type { MyrlinTheme, ThemeId } from '../theme/types';
import { useThemeStore } from '../stores/theme-store';

/** Theme context value shape */
interface ThemeContextValue {
  /** The full resolved theme object */
  theme: MyrlinTheme;
  /** Current theme ID */
  themeId: ThemeId;
  /** Switch to a different theme */
  setTheme: (id: ThemeId) => void;
}

/**
 * React context for theme distribution.
 * Null default; ThemeProvider must be an ancestor or useTheme will throw.
 */
const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * ThemeProvider - Wraps the component tree with the active theme.
 *
 * Reads from the Zustand theme store and provides the theme, themeId,
 * and setTheme function to all descendants via React context.
 *
 * Place this at the app root (inside _layout.tsx).
 *
 * @param props.children - Child components to receive theme context
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const themeId = useThemeStore((s) => s.themeId);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, themeId, setTheme }),
    [theme, themeId, setTheme]
  );

  return React.createElement(
    ThemeContext.Provider,
    { value },
    children
  );
}

/**
 * useTheme - Hook to access the current theme, theme ID, and setter.
 *
 * Must be called within a ThemeProvider. Throws if used outside one.
 *
 * @returns Theme context value with theme, themeId, and setTheme
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { theme, setTheme } = useTheme();
 *   return (
 *     <View style={{ backgroundColor: theme.colors.bgPrimary }}>
 *       <Text style={{ color: theme.colors.textPrimary }}>Hello</Text>
 *     </View>
 *   );
 * }
 * ```
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error(
      'useTheme must be used within a ThemeProvider. ' +
      'Wrap your app root with <ThemeProvider>.'
    );
  }
  return context;
}
