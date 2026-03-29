/**
 * terminal.ts - Bridge protocol types for the hybrid WebView terminal.
 *
 * Defines the postMessage contract between React Native and the xterm.js
 * WebView. All messages are JSON-serialized strings. The WebSocket for
 * PTY data lives INSIDE the WebView (not bridged through RN) for
 * performance; only control messages cross the bridge.
 *
 * ToWebView: RN -> WebView (injected via webViewRef.injectJavaScript)
 * FromWebView: WebView -> RN (via window.ReactNativeWebView.postMessage)
 */

import type { MyrlinTheme } from '../theme/types';

// ── RN -> WebView Messages ───────────────────────────────────

/** Messages sent from React Native to the terminal WebView */
export type ToWebView =
  | { type: 'write'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'setTheme'; theme: XtermTheme }
  | { type: 'clear' }
  | { type: 'connect'; wsUrl: string; token: string; sessionId: string }
  | { type: 'disconnect' }
  | { type: 'dispose' }
  | { type: 'getSelectedText' }
  | { type: 'getVisibleText' }
  | { type: 'getScrollback' }
  | { type: 'selectAll' }
  | { type: 'scrollToBottom' }
  | { type: 'focus' }
  | { type: 'blur' };

// ── WebView -> RN Messages ───────────────────────────────────

/** Messages sent from the terminal WebView to React Native */
export type FromWebView =
  | { type: 'ready' }
  | { type: 'selectedText'; text: string }
  | { type: 'visibleText'; text: string }
  | { type: 'scrollback'; text: string }
  | { type: 'activity'; kind: string; detail: string }
  | { type: 'bell' }
  | { type: 'titleChange'; title: string }
  | { type: 'dimensions'; cols: number; rows: number }
  | { type: 'disconnected' }
  | { type: 'exit'; exitCode: number };

// ── xterm.js Theme ───────────────────────────────────────────

/**
 * xterm.js theme object (subset of ITheme).
 * Maps directly to xterm.js Terminal.options.theme property.
 * All values are CSS hex color strings.
 */
export interface XtermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// ── Theme Converter ──────────────────────────────────────────

/**
 * Convert a MyrlinTheme to an xterm.js ITheme-compatible object.
 *
 * Maps Catppuccin palette colors to ANSI terminal color slots.
 * Selection background uses accent color at 25% opacity (hex alpha '40').
 * Bright color variants mirror their normal counterparts per Catppuccin convention.
 *
 * @param theme - The active MyrlinTheme from useTheme()
 * @returns An XtermTheme suitable for xterm.js Terminal.options.theme
 */
export function myrlinToXtermTheme(theme: MyrlinTheme): XtermTheme {
  return {
    background: theme.colors.base,
    foreground: theme.colors.text,
    cursor: theme.colors.rosewater,
    cursorAccent: theme.colors.base,
    selectionBackground: theme.colors.accent + '40',
    selectionForeground: theme.colors.text,
    black: theme.colors.surface1,
    red: theme.colors.red,
    green: theme.colors.green,
    yellow: theme.colors.yellow,
    blue: theme.colors.blue,
    magenta: theme.colors.mauve,
    cyan: theme.colors.teal,
    white: theme.colors.subtext1,
    brightBlack: theme.colors.surface2,
    brightRed: theme.colors.red,
    brightGreen: theme.colors.green,
    brightYellow: theme.colors.yellow,
    brightBlue: theme.colors.blue,
    brightMagenta: theme.colors.mauve,
    brightCyan: theme.colors.teal,
    brightWhite: theme.colors.subtext0,
  };
}
