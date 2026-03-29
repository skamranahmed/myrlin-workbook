/**
 * index.tsx - Root route redirect.
 *
 * Expo Router requires an index route at app/index.tsx.
 * This redirects to (tabs) if a server is paired,
 * or (auth)/onboarding if no server exists.
 */

import { Redirect } from 'expo-router';
import { useServerStore } from '@/stores/server-store';

/**
 * RootIndex - Redirects to the appropriate initial screen.
 * @returns Redirect component pointing to tabs or auth onboarding
 */
export default function RootIndex() {
  const activeServer = useServerStore((s) => s.getActiveServer());

  if (!activeServer) {
    return <Redirect href="/(auth)/onboarding" />;
  }

  return <Redirect href="/(tabs)/sessions" />;
}
