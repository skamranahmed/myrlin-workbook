/**
 * useTerminalBridge.ts - Hook managing the postMessage bridge between
 * React Native and the xterm.js WebView.
 *
 * Provides sendToWebView() to inject messages into the WebView and
 * handleWebViewMessage() to parse incoming messages from the WebView.
 * Callbacks are stored in refs to avoid stale closures in effects.
 *
 * The bridge protocol types are defined in types/terminal.ts.
 */

import { useRef, useCallback, useState } from 'react';
import type WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import type { ToWebView, FromWebView } from '../../types/terminal';

/** Callback options for the terminal bridge */
export interface TerminalBridgeCallbacks {
  /** Fired when activity is detected in terminal output */
  onActivity?: (kind: string, detail: string) => void;
  /** Fired when the PTY session exits */
  onExit?: (code: number) => void;
  /** Fired when the WebView signals it is ready */
  onReady?: () => void;
  /** Fired when xterm.js reports its dimensions after fit */
  onDimensions?: (cols: number, rows: number) => void;
  /** Fired when text extraction completes (selectedText, visibleText, scrollback) */
  onText?: (kind: string, text: string) => void;
  /** Fired when the WebSocket disconnects */
  onDisconnected?: () => void;
}

/** Return type from useTerminalBridge */
export interface TerminalBridgeHandle {
  /** Ref to attach to the WebView component */
  webViewRef: React.RefObject<WebView | null>;
  /** Send a typed message to the WebView */
  sendToWebView: (msg: ToWebView) => void;
  /** onMessage handler for the WebView component */
  handleWebViewMessage: (event: WebViewMessageEvent) => void;
  /** Whether the WebView has signaled 'ready' */
  isReady: boolean;
  /** Current terminal dimensions from xterm.js fit */
  dimensions: { cols: number; rows: number } | null;
  /** Whether the WebSocket inside the WebView is connected */
  isConnected: boolean;
}

/**
 * useTerminalBridge - Manages the postMessage protocol between RN and WebView.
 *
 * The WebView contains xterm.js and the WebSocket connection. This hook
 * abstracts the string-based postMessage API into typed function calls.
 *
 * Callbacks are stored in refs so the handleWebViewMessage callback
 * identity is stable (it never changes). This prevents unnecessary
 * WebView re-renders from callback prop changes.
 *
 * @param callbacks - Optional event handlers for bridge messages
 * @returns Bridge handle with ref, sender, handler, and state
 */
export function useTerminalBridge(
  callbacks?: TerminalBridgeCallbacks
): TerminalBridgeHandle {
  const webViewRef = useRef<WebView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [dimensions, setDimensions] = useState<{ cols: number; rows: number } | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store callbacks in refs to avoid stale closures
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  /**
   * Send a typed message to the WebView via injectJavaScript.
   * The WebView's window.handleRNMessage function processes it.
   * @param msg - Typed ToWebView message
   */
  const sendToWebView = useCallback((msg: ToWebView) => {
    const js = `window.handleRNMessage(${JSON.stringify(msg)}); true;`;
    webViewRef.current?.injectJavaScript(js);
  }, []);

  /**
   * Handle incoming messages from the WebView.
   * Parses the JSON string, routes by message type, updates state,
   * and fires appropriate callbacks.
   * @param event - WebView message event with nativeEvent.data
   */
  const handleWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const msg: FromWebView = JSON.parse(event.nativeEvent.data);
      const cbs = callbacksRef.current;

      switch (msg.type) {
        case 'ready':
          setIsReady(true);
          setIsConnected(true);
          cbs?.onReady?.();
          break;

        case 'dimensions':
          setDimensions({ cols: msg.cols, rows: msg.rows });
          cbs?.onDimensions?.(msg.cols, msg.rows);
          break;

        case 'activity':
          cbs?.onActivity?.(msg.kind, msg.detail);
          break;

        case 'exit':
          cbs?.onExit?.(msg.exitCode);
          break;

        case 'disconnected':
          setIsConnected(false);
          cbs?.onDisconnected?.();
          break;

        case 'selectedText':
          cbs?.onText?.('selectedText', msg.text);
          break;

        case 'visibleText':
          cbs?.onText?.('visibleText', msg.text);
          break;

        case 'scrollback':
          cbs?.onText?.('scrollback', msg.text);
          break;

        case 'bell':
          // Bell events can be handled by future haptic feedback
          break;

        case 'titleChange':
          // Title changes can be surfaced in the header
          break;
      }
    } catch (_) {
      // Ignore malformed messages from WebView
    }
  }, []);

  return {
    webViewRef,
    sendToWebView,
    handleWebViewMessage,
    isReady,
    dimensions,
    isConnected,
  };
}
