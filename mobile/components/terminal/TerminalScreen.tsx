/**
 * TerminalScreen.tsx - Full terminal screen composing header, WebView, and input placeholder.
 *
 * This is the main container for the terminal experience. It composes:
 *   1. TerminalHeader (session name, status, activity indicator)
 *   2. TerminalWebView (xterm.js rendering surface, flex: 1)
 *   3. Input placeholder (48px, to be replaced by TerminalInput in Plan 02)
 *
 * Data flow:
 *   - useSession(sessionId) provides session metadata
 *   - useServerStore provides server URL and auth token
 *   - useTerminalBridge manages the postMessage protocol
 *   - useTheme provides Catppuccin theme for header and backgrounds
 */

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useTheme } from '../../hooks/useTheme';
import { useSession } from '../../hooks/useSessions';
import { useServerStore } from '../../stores/server-store';
import { Skeleton } from '../ui';
import { fonts } from '../../theme/fonts';

import { TerminalHeader } from './TerminalHeader';
import { TerminalWebView } from './TerminalWebView';
import { useTerminalBridge } from './useTerminalBridge';
import type { StatusType } from '../ui';

/** Props for the TerminalScreen component */
export interface TerminalScreenProps {
  /** Session UUID to display in the terminal */
  sessionId: string;
}

/**
 * TerminalScreen - Full terminal view with header, xterm.js WebView, and input area.
 *
 * Fetches session data, initializes the terminal bridge, and wires up
 * activity detection. The input area is a placeholder for Plan 02
 * (native TextInput with keyboard controller).
 *
 * SafeAreaView handles the top safe area; bottom is left for the
 * keyboard controller to manage in Plan 02.
 */
export function TerminalScreen({ sessionId }: TerminalScreenProps) {
  const { theme } = useTheme();
  const router = useRouter();
  const { colors, spacing } = theme;

  // Session data
  const sessionQuery = useSession(sessionId);
  const session = sessionQuery.data;

  // Server connection info
  const activeServer = useServerStore((s) => s.getActiveServer());
  const serverUrl = activeServer?.url ?? '';
  const token = activeServer?.token ?? '';

  // Activity state tracked from bridge callbacks
  const [activity, setActivity] = useState<{ kind: string; detail: string } | undefined>();

  /**
   * Handle activity events from the terminal bridge.
   * Updates the header activity indicator.
   */
  const handleActivity = useCallback((kind: string, detail: string) => {
    setActivity({ kind, detail });
  }, []);

  // Terminal bridge with activity callback
  const bridge = useTerminalBridge({
    onActivity: handleActivity,
  });

  /**
   * Navigate back to the session detail screen.
   */
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  // Loading skeleton while session data loads
  if (sessionQuery.isLoading || !session) {
    return (
      <SafeAreaView
        edges={['top']}
        style={[styles.container, { backgroundColor: colors.base }]}
      >
        <View style={[styles.loadingHeader, { backgroundColor: colors.bgSecondary }]}>
          <Skeleton width={180} height={20} />
        </View>
        <View style={styles.loadingBody}>
          <Skeleton width={300} height={400} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.base }]}
    >
      {/* Header with session name, status, and activity */}
      <TerminalHeader
        sessionName={session.name}
        status={session.status as StatusType}
        activity={activity}
        onBack={handleBack}
      />

      {/* Terminal WebView (flex: 1, takes remaining space) */}
      <TerminalWebView
        sessionId={sessionId}
        serverUrl={serverUrl}
        token={token}
        bridge={bridge}
      />

      {/* Input placeholder (Plan 02 will replace with TerminalInput + KeyboardStickyView) */}
      <View
        style={[
          styles.inputPlaceholder,
          {
            backgroundColor: colors.bgSecondary,
            borderTopColor: colors.borderSubtle,
          },
        ]}
      >
        <Text
          style={[
            styles.placeholderText,
            { color: colors.textMuted, fontFamily: fonts.sans.regular },
          ]}
        >
          Input coming in Plan 02
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingHeader: {
    height: 48,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  loadingBody: {
    flex: 1,
    padding: 16,
  },
  inputPlaceholder: {
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopWidth: 1,
  },
  placeholderText: {
    fontSize: 13,
  },
});
