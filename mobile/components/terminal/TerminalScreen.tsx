/**
 * TerminalScreen.tsx - Full terminal screen composing header, WebView, toolbar, and input.
 *
 * This is the main container for the terminal experience. It composes:
 *   1. TerminalHeader (session name, status, activity indicator)
 *   2. TerminalWebView (xterm.js rendering surface, flex: 1)
 *   3. KeyboardStickyView wrapping:
 *      a. TerminalToolbar (Copy, Paste, Share, Camera, Reader)
 *      b. TerminalInput (native TextInput with send button)
 *
 * Data flow:
 *   - useSession(sessionId) provides session metadata
 *   - useServerStore provides server URL and auth token
 *   - useTerminalBridge manages the postMessage protocol
 *   - useTheme provides Catppuccin theme for header and backgrounds
 *   - KeyboardStickyView keeps toolbar + input above the keyboard
 *
 * Two-step text actions (copy, share):
 *   1. Toolbar button sets pendingTextAction state ('copy' or 'share')
 *   2. Bridge sends getVisibleText to WebView
 *   3. WebView responds via onText callback
 *   4. Screen executes the pending action (clipboard or share sheet)
 *   5. Clears pendingTextAction
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, Share, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { KeyboardProvider, KeyboardStickyView } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';

import { useTheme } from '../../hooks/useTheme';
import { useSession } from '../../hooks/useSessions';
import { useServerStore } from '../../stores/server-store';
import { Skeleton } from '../ui';
import { fonts } from '../../theme/fonts';

import { TerminalHeader } from './TerminalHeader';
import { TerminalWebView } from './TerminalWebView';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalInput } from './TerminalInput';
import { useTerminalBridge } from './useTerminalBridge';
import type { StatusType } from '../ui';

/** Props for the TerminalScreen component */
export interface TerminalScreenProps {
  /** Session UUID to display in the terminal */
  sessionId: string;
  /** Whether this screen is the active page in a carousel (default true) */
  isActive?: boolean;
}

/**
 * TerminalScreen - Full terminal view with header, xterm.js WebView, toolbar, and input.
 *
 * Fetches session data, initializes the terminal bridge, and wires up
 * activity detection. KeyboardStickyView from react-native-keyboard-controller
 * keeps the toolbar and input pinned above the software keyboard on all devices.
 *
 * The WebView area shrinks automatically when the keyboard opens because
 * KeyboardStickyView pushes content upward, and the WebView's ResizeObserver
 * (in terminal.html) re-fits xterm.js to the new dimensions.
 *
 * SafeAreaView handles the top safe area; bottom safe area is managed
 * by KeyboardStickyView's offset behavior.
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

  // Pending text action for two-step clipboard/share operations
  const pendingTextActionRef = useRef<'copy' | 'share' | null>(null);

  // Reader mode placeholder state (full implementation in Plan 03)
  const [readerMode, setReaderMode] = useState(false);

  /**
   * Handle activity events from the terminal bridge.
   * Updates the header activity indicator.
   */
  const handleActivity = useCallback((kind: string, detail: string) => {
    setActivity({ kind, detail });
  }, []);

  /**
   * Handle text responses from the bridge (selectedText, visibleText, scrollback).
   * Checks pendingTextAction and executes copy or share accordingly.
   */
  const handleText = useCallback(async (kind: string, text: string) => {
    const action = pendingTextActionRef.current;
    if (!action || !text) {
      pendingTextActionRef.current = null;
      return;
    }

    pendingTextActionRef.current = null;

    if (action === 'copy') {
      await Clipboard.setStringAsync(text);
    } else if (action === 'share') {
      try {
        await Share.share({ message: text });
      } catch (_) {
        // User cancelled share sheet or share failed
      }
    }
  }, []);

  // Terminal bridge with activity and text callbacks
  const bridge = useTerminalBridge({
    onActivity: handleActivity,
    onText: handleText,
  });

  /**
   * Handle text request from toolbar (copy or share).
   * Sets the pending action and asks the bridge for visible text.
   */
  const handleRequestText = useCallback((action: 'copy' | 'share') => {
    pendingTextActionRef.current = action;
    bridge.sendToWebView({ type: 'getVisibleText' });
  }, [bridge]);

  /**
   * Handle command submission from the text input.
   * The text already includes a trailing newline from TerminalInput.
   */
  const handleInputSubmit = useCallback((text: string) => {
    bridge.sendToWebView({ type: 'write', data: text });
  }, [bridge]);

  /**
   * Navigate back to the session detail screen.
   */
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  /**
   * Toggle reader mode overlay.
   * Placeholder for Plan 03 implementation.
   */
  const handleReaderToggle = useCallback(() => {
    setReaderMode((prev) => !prev);
  }, []);

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
    <KeyboardProvider>
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
        <View style={styles.webViewContainer}>
          <TerminalWebView
            sessionId={sessionId}
            serverUrl={serverUrl}
            token={token}
            bridge={bridge}
          />
        </View>

        {/* Reader mode placeholder (Plan 03 will replace with full implementation) */}
        {readerMode && (
          <View
            style={[
              styles.readerOverlay,
              { backgroundColor: colors.bgPrimary },
            ]}
          >
            <Text
              style={[
                styles.readerPlaceholder,
                { color: colors.textMuted, fontFamily: fonts.sans.regular },
              ]}
            >
              Reader mode coming in Plan 03
            </Text>
          </View>
        )}

        {/* Toolbar + Input stick above keyboard via KeyboardStickyView */}
        <KeyboardStickyView offset={{ closed: 0, opened: 0 }}>
          <TerminalToolbar
            sendToWebView={bridge.sendToWebView}
            onRequestText={handleRequestText}
            onReaderToggle={handleReaderToggle}
          />
          <TerminalInput onSubmit={handleInputSubmit} />
        </KeyboardStickyView>
      </SafeAreaView>
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webViewContainer: {
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
  readerOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 48,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  readerPlaceholder: {
    fontSize: 16,
  },
});
