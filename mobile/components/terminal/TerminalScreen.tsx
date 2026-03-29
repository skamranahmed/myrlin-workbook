/**
 * TerminalScreen.tsx - Full terminal screen composing header, WebView, toolbar, and input.
 *
 * This is the main container for the terminal experience. It composes:
 *   1. TerminalHeader (session name, status, activity indicator)
 *   2. TerminalWebView (xterm.js rendering surface, flex: 1)
 *   3. ReaderMode overlay (full-screen scrollable text view, toggled on/off)
 *   4. KeyboardStickyView wrapping:
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
 * Carousel integration:
 *   - isActive prop controls whether the WebView is mounted (default true)
 *   - When isActive=false, a lightweight placeholder is shown instead
 *   - This enables lazy mounting in TerminalCarousel for memory safety
 *
 * Reader mode:
 *   - Toggle sends getScrollback to bridge, receives scrollback text
 *   - ReaderMode overlay renders above the terminal (absolute positioned)
 *   - WebSocket stays alive underneath for seamless return to live terminal
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
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../hooks/useTheme';
import { useSession } from '../../hooks/useSessions';
import { useServerStore } from '../../stores/server-store';
import { Skeleton } from '../ui';
import { fonts } from '../../theme/fonts';

import { TerminalHeader } from './TerminalHeader';
import { TerminalWebView } from './TerminalWebView';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalInput } from './TerminalInput';
import { ReaderMode } from './ReaderMode';
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
 * When isActive is false (non-active carousel page), renders a lightweight
 * placeholder instead of the full terminal to conserve memory.
 *
 * SafeAreaView handles the top safe area; bottom safe area is managed
 * by KeyboardStickyView's offset behavior.
 */
export function TerminalScreen({ sessionId, isActive = true }: TerminalScreenProps) {
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

  // Reader mode state
  const [readerMode, setReaderMode] = useState(false);
  const [scrollbackText, setScrollbackText] = useState<string>('');
  const [scrollbackLoading, setScrollbackLoading] = useState(false);

  /**
   * Handle activity events from the terminal bridge.
   * Updates the header activity indicator.
   */
  const handleActivity = useCallback((kind: string, detail: string) => {
    setActivity({ kind, detail });
  }, []);

  /**
   * Handle text responses from the bridge (selectedText, visibleText, scrollback).
   * Routes scrollback text to reader mode state. Routes visibleText to
   * the pending copy/share action.
   */
  const handleText = useCallback(async (kind: string, text: string) => {
    // Handle scrollback text for reader mode
    if (kind === 'scrollback') {
      setScrollbackText(text);
      setScrollbackLoading(false);
      return;
    }

    // Handle copy/share actions for visibleText and selectedText
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
   * When toggling ON: requests scrollback from the bridge and shows loading state.
   * When toggling OFF: clears scrollback text and hides overlay.
   */
  const handleReaderToggle = useCallback(() => {
    setReaderMode((prev) => {
      if (!prev) {
        // Turning ON: request scrollback from bridge
        setScrollbackLoading(true);
        setScrollbackText('');
        bridge.sendToWebView({ type: 'getScrollback' });
      } else {
        // Turning OFF: clear state
        setScrollbackText('');
        setScrollbackLoading(false);
      }
      return !prev;
    });
  }, [bridge]);

  /**
   * Close reader mode overlay (used by ReaderMode's close button).
   */
  const handleReaderClose = useCallback(() => {
    setReaderMode(false);
    setScrollbackText('');
    setScrollbackLoading(false);
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

  // Inactive carousel page: show lightweight placeholder (no WebView mounted)
  if (!isActive) {
    return (
      <View style={[styles.container, { backgroundColor: colors.base }]}>
        <View style={styles.inactivePlaceholder}>
          <Ionicons name="terminal-outline" size={48} color={colors.surface2} />
          <Text
            style={[
              styles.inactiveTitle,
              { color: colors.textSecondary, fontFamily: fonts.sans.semibold },
            ]}
            numberOfLines={1}
          >
            {session.name}
          </Text>
          <Text
            style={[
              styles.inactiveHint,
              { color: colors.textMuted, fontFamily: fonts.sans.regular },
            ]}
          >
            Swipe to activate
          </Text>
        </View>
      </View>
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

        {/* Reader mode overlay (absolute positioned above terminal, WebSocket stays alive) */}
        {readerMode && (
          <ReaderMode
            text={scrollbackText}
            onClose={handleReaderClose}
            isLoading={scrollbackLoading}
          />
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
  inactivePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  inactiveTitle: {
    fontSize: 18,
    maxWidth: '80%',
    textAlign: 'center',
  },
  inactiveHint: {
    fontSize: 14,
  },
});
