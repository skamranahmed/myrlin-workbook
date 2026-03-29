/**
 * TerminalWebView.tsx - WebView wrapper for xterm.js terminal rendering.
 *
 * Loads the self-contained terminal.html asset (with inlined xterm.js)
 * in a react-native-webview. Connects to the server PTY via WebSocket
 * (inside the WebView, not bridged through RN for performance).
 *
 * Handles:
 *   - Loading terminal.html from bundled assets
 *   - Sending connect/disconnect/setTheme messages via the bridge
 *   - Reconnecting WebSocket on app foreground resume (AppState)
 *   - Disposing xterm.js and WebSocket on unmount
 */

import React, { useEffect, useRef } from 'react';
import { View, AppState, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';

import { useTheme } from '../../hooks/useTheme';
import { myrlinToXtermTheme } from '../../types/terminal';
import type { TerminalBridgeHandle } from './useTerminalBridge';

/** Props for the TerminalWebView component */
export interface TerminalWebViewProps {
  /** Session UUID to connect to */
  sessionId: string;
  /** Server base URL (http or https) */
  serverUrl: string;
  /** Bearer auth token for WebSocket authentication */
  token: string;
  /** Bridge handle from useTerminalBridge() */
  bridge: TerminalBridgeHandle;
}

/**
 * Build the WebSocket URL from a server HTTP URL.
 * Replaces http(s) with ws(s) and appends the terminal path.
 * @param serverUrl - Server base URL (e.g. "http://192.168.1.50:3456")
 * @returns WebSocket URL (e.g. "ws://192.168.1.50:3456/ws/terminal")
 */
function buildWsUrl(serverUrl: string): string {
  return serverUrl
    .replace(/^https:/, 'wss:')
    .replace(/^http:/, 'ws:')
    .replace(/\/+$/, '') + '/ws/terminal';
}

/**
 * TerminalWebView - Renders xterm.js in a WebView with bridge protocol.
 *
 * On mount + ready: sends connect message with WebSocket URL, token, session ID.
 * On theme change: sends setTheme with converted Catppuccin colors.
 * On app foreground resume: reconnects WebSocket if disconnected.
 * On unmount: sends dispose to clean up xterm.js and close WebSocket.
 */
export function TerminalWebView({
  sessionId,
  serverUrl,
  token,
  bridge,
}: TerminalWebViewProps) {
  const { theme } = useTheme();
  const hasConnected = useRef(false);
  const htmlAssetUri = useRef<string | null>(null);
  const [assetReady, setAssetReady] = React.useState(false);

  // Resolve the terminal.html asset URI on mount
  useEffect(() => {
    let mounted = true;
    async function loadAsset() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const asset = Asset.fromModule(require('../../assets/terminal.html'));
        await asset.downloadAsync();
        if (mounted && asset.localUri) {
          htmlAssetUri.current = asset.localUri;
          setAssetReady(true);
        }
      } catch (_) {
        // Fallback: asset loading failed, will show empty terminal
      }
    }
    loadAsset();
    return () => { mounted = false; };
  }, []);

  // Connect to PTY when WebView is ready
  useEffect(() => {
    if (bridge.isReady && !hasConnected.current) {
      hasConnected.current = true;
      const wsUrl = buildWsUrl(serverUrl);
      bridge.sendToWebView({
        type: 'connect',
        wsUrl,
        token,
        sessionId,
      });
      // Send initial theme
      bridge.sendToWebView({
        type: 'setTheme',
        theme: myrlinToXtermTheme(theme),
      });
    }
  }, [bridge.isReady, serverUrl, token, sessionId, theme, bridge]);

  // Update theme when it changes (after initial connection)
  useEffect(() => {
    if (bridge.isReady && hasConnected.current) {
      bridge.sendToWebView({
        type: 'setTheme',
        theme: myrlinToXtermTheme(theme),
      });
    }
  }, [theme, bridge]);

  // Reconnect WebSocket on app foreground resume
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !bridge.isConnected && hasConnected.current) {
        const wsUrl = buildWsUrl(serverUrl);
        bridge.sendToWebView({
          type: 'connect',
          wsUrl,
          token,
          sessionId,
        });
      }
    });
    return () => subscription.remove();
  }, [serverUrl, token, sessionId, bridge]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      bridge.sendToWebView({ type: 'dispose' });
    };
  }, [bridge]);

  if (!assetReady || !htmlAssetUri.current) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.base }]} />
    );
  }

  return (
    <WebView
      ref={bridge.webViewRef as React.RefObject<WebView>}
      source={{ uri: htmlAssetUri.current }}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      bounces={false}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      onMessage={bridge.handleWebViewMessage}
      // Prevent WebView from capturing keyboard events
      keyboardDisplayRequiresUserAction={false}
      // Disable default overscroll
      overScrollMode="never"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
