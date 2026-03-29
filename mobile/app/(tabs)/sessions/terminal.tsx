/**
 * sessions/terminal.tsx - Route screen for the terminal view.
 *
 * Wires the TerminalScreen component to expo-router, extracting the
 * session ID from search params. Hides the default header and tab bar
 * since TerminalScreen provides its own header.
 *
 * Navigation: /sessions/terminal?id={sessionId}
 */

import { useLocalSearchParams } from 'expo-router';

import { TerminalScreen } from '@/components/terminal/TerminalScreen';

/**
 * TerminalRoute - Expo Router screen for terminal view.
 *
 * Reads the `id` search parameter and passes it to TerminalScreen.
 * The Stack.Screen options in _layout.tsx handle hiding the header
 * and animation.
 */
export default function TerminalRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TerminalScreen sessionId={id ?? ''} />;
}
