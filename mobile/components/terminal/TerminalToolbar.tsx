/**
 * TerminalToolbar.tsx - Action toolbar for terminal clipboard, share, camera, and reader mode.
 *
 * Renders a horizontal row of icon buttons between the WebView and TextInput.
 * Each button triggers either a direct action (paste, camera) or a two-step
 * bridge request (copy, share) where text is fetched from the WebView first.
 *
 * Buttons:
 *   - Copy: requests visible text from bridge, copies to clipboard
 *   - Paste: reads clipboard, writes to terminal via bridge
 *   - Share: requests visible text from bridge, opens native share sheet
 *   - Camera: launches image picker (upload is best-effort)
 *   - Reader: toggles reader mode (implemented in Plan 03)
 *
 * Data flow: Button press -> bridge request or direct action -> feedback
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Alert,
  Share,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';

import { useTheme } from '../../hooks/useTheme';
import type { ToWebView } from '../../types/terminal';

/** Props for the TerminalToolbar component */
export interface TerminalToolbarProps {
  /** Send a typed message to the terminal WebView */
  sendToWebView: (msg: ToWebView) => void;
  /** Callback when the pending text action should execute (wired by TerminalScreen) */
  onRequestText: (action: 'copy' | 'share') => void;
  /** Toggle reader mode (implemented in Plan 03) */
  onReaderToggle?: () => void;
}

/** Individual toolbar button definition */
interface ToolbarButton {
  /** Ionicons icon name */
  icon: keyof typeof Ionicons.glyphMap;
  /** Accessibility label */
  label: string;
  /** Button press handler */
  onPress: () => void;
}

/**
 * TerminalToolbar - Horizontal action bar for terminal operations.
 *
 * Positioned between the WebView and TextInput. Uses a horizontal ScrollView
 * for overflow on smaller screens. Each button is 40x40 with opacity feedback.
 *
 * @param props.sendToWebView - Bridge message sender
 * @param props.onRequestText - Triggers text fetch for copy/share actions
 * @param props.onReaderToggle - Toggles reader mode overlay
 */
export function TerminalToolbar({
  sendToWebView,
  onRequestText,
  onReaderToggle,
}: TerminalToolbarProps) {
  const { theme } = useTheme();
  const { colors, spacing } = theme;
  const [feedback, setFeedback] = useState<string | null>(null);

  /**
   * Copy visible terminal text to clipboard.
   * Sends getVisibleText to bridge; TerminalScreen handles the response
   * via pendingTextAction state.
   */
  const handleCopy = useCallback(() => {
    onRequestText('copy');
  }, [onRequestText]);

  /**
   * Paste clipboard contents into the terminal PTY.
   * Reads from system clipboard and writes directly to the WebView.
   */
  const handlePaste = useCallback(async () => {
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (clipboardText) {
        sendToWebView({ type: 'write', data: clipboardText });
      }
    } catch (_) {
      // Clipboard read failed silently
    }
  }, [sendToWebView]);

  /**
   * Share visible terminal text via native share sheet.
   * Sends getVisibleText to bridge; TerminalScreen handles the response
   * via pendingTextAction state.
   */
  const handleShare = useCallback(() => {
    onRequestText('share');
  }, [onRequestText]);

  /**
   * Launch image picker for camera/gallery image selection.
   * Actual upload requires a server endpoint; shows status feedback.
   */
  const handleCamera = useCallback(async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (!result.canceled && result.assets.length > 0) {
        // Image selected; upload endpoint required for full functionality
        Alert.alert(
          'Image Selected',
          'Image was selected successfully. Upload to terminal sessions requires server support.',
          [{ text: 'OK' }]
        );
      }
    } catch (_) {
      Alert.alert('Error', 'Failed to open image picker.');
    }
  }, []);

  /**
   * Toggle reader mode (scrollable text view of terminal output).
   * Full implementation in Plan 03.
   */
  const handleReader = useCallback(() => {
    onReaderToggle?.();
  }, [onReaderToggle]);

  /** Button definitions for the toolbar */
  const buttons: ToolbarButton[] = [
    { icon: 'copy-outline', label: 'Copy terminal text', onPress: handleCopy },
    { icon: 'clipboard-outline', label: 'Paste from clipboard', onPress: handlePaste },
    { icon: 'share-outline', label: 'Share terminal text', onPress: handleShare },
    { icon: 'camera-outline', label: 'Upload image', onPress: handleCamera },
    { icon: 'book-outline', label: 'Reader mode', onPress: handleReader },
  ];

  return (
    <View
      style={[
        styles.container,
        {
          borderTopColor: colors.borderSubtle,
          backgroundColor: colors.bgSecondary,
        },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingHorizontal: spacing.md },
        ]}
      >
        {buttons.map((button) => (
          <Pressable
            key={button.label}
            onPress={button.onPress}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: pressed ? colors.bgElevated : 'transparent',
                borderRadius: theme.radius.sm,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={button.label}
          >
            <Ionicons
              name={button.icon}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
  },
  scrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  button: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
