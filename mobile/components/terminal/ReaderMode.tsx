/**
 * ReaderMode.tsx - Full-screen scrollable text overlay for terminal output.
 *
 * Renders terminal scrollback text in a native ScrollView with monospace
 * font and selectable text. This is an overlay on top of the terminal
 * WebView, so the WebSocket connection stays alive underneath.
 *
 * Features:
 *   - Selectable monospace text for easy reading of build logs and errors
 *   - Copy All button (copies full text to clipboard via expo-clipboard)
 *   - Share button (native share sheet via RN Share API)
 *   - Skeleton loading state while scrollback is fetched from bridge
 *   - Empty state when no terminal output exists yet
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Share,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';

import { useTheme } from '../../hooks/useTheme';
import { Skeleton } from '../ui';
import { fonts } from '../../theme/fonts';

/** Props for the ReaderMode component */
export interface ReaderModeProps {
  /** The full scrollback text from the terminal */
  text: string;
  /** Callback to close the reader mode overlay */
  onClose: () => void;
  /** Whether the scrollback text is still being fetched */
  isLoading: boolean;
}

/**
 * ReaderMode - Full-screen scrollable terminal output overlay.
 *
 * Displays terminal scrollback in a native ScrollView with selectable
 * monospace text. Positioned absolutely over the terminal WebView so
 * the underlying WebSocket connection remains active.
 *
 * @param props - Text content, close handler, and loading state
 */
export function ReaderMode({ text, onClose, isLoading }: ReaderModeProps) {
  const { theme } = useTheme();
  const { colors, spacing } = theme;

  /**
   * Copy the full scrollback text to the system clipboard.
   */
  const handleCopyAll = useCallback(async () => {
    if (text) {
      await Clipboard.setStringAsync(text);
    }
  }, [text]);

  /**
   * Open the native share sheet with the scrollback text.
   */
  const handleShare = useCallback(async () => {
    if (text) {
      try {
        await Share.share({ message: text });
      } catch (_) {
        // User cancelled share sheet
      }
    }
  }, [text]);

  return (
    <View
      style={[
        styles.overlay,
        { backgroundColor: colors.bgPrimary + 'FA' },
      ]}
    >
      {/* Top bar with title and action buttons */}
      <View style={[styles.topBar, { borderBottomColor: colors.surface1 }]}>
        <Text
          style={[
            styles.title,
            { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
          ]}
        >
          Reader Mode
        </Text>

        <View style={styles.actions}>
          {/* Copy All button */}
          <Pressable
            onPress={handleCopyAll}
            style={[styles.actionButton, { backgroundColor: colors.surface0 }]}
            hitSlop={8}
            disabled={isLoading || !text}
          >
            <Ionicons name="copy-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.actionLabel, { color: colors.textSecondary, fontFamily: fonts.sans.medium }]}>
              Copy
            </Text>
          </Pressable>

          {/* Share button */}
          <Pressable
            onPress={handleShare}
            style={[styles.actionButton, { backgroundColor: colors.surface0 }]}
            hitSlop={8}
            disabled={isLoading || !text}
          >
            <Ionicons name="share-outline" size={18} color={colors.textSecondary} />
            <Text style={[styles.actionLabel, { color: colors.textSecondary, fontFamily: fonts.sans.medium }]}>
              Share
            </Text>
          </Pressable>

          {/* Close button */}
          <Pressable onPress={onClose} style={styles.closeButton} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Scrollable text content */}
      {isLoading ? (
        <View style={[styles.loadingContainer, { padding: spacing.md }]}>
          <Skeleton width={300} height={16} />
          <View style={{ height: spacing.sm }} />
          <Skeleton width={260} height={16} />
          <View style={{ height: spacing.sm }} />
          <Skeleton width={280} height={16} />
          <View style={{ height: spacing.sm }} />
          <Skeleton width={200} height={16} />
        </View>
      ) : text ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { padding: spacing.md }]}
          showsVerticalScrollIndicator
        >
          <Text
            selectable
            style={[
              styles.terminalText,
              {
                color: colors.textPrimary,
                fontFamily: fonts.mono.regular,
              },
            ]}
          >
            {text}
          </Text>
        </ScrollView>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="terminal-outline" size={48} color={colors.textMuted} />
          <Text
            style={[
              styles.emptyText,
              { color: colors.textMuted, fontFamily: fonts.sans.regular },
            ]}
          >
            No terminal output yet
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    top: 48,
    zIndex: 10,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  actionLabel: {
    fontSize: 13,
  },
  closeButton: {
    marginLeft: 4,
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  terminalText: {
    fontSize: 13,
    lineHeight: 18,
  },
  loadingContainer: {
    flex: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontSize: 15,
  },
});
