/**
 * TerminalInput.tsx - Native TextInput with send button for terminal commands.
 *
 * Provides a styled text input field with a send button. Commands are submitted
 * with a trailing newline character ('\n') which the PTY expects to execute.
 * Uses blurOnSubmit={false} to keep the keyboard open after sending.
 *
 * Voice dictation is handled by iOS native keyboard dictation button.
 * No additional library is required for voice input.
 *
 * Data flow: User types -> onSubmit(text + '\n') -> parent sends to bridge
 */

import React, { useState, useCallback } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../hooks/useTheme';
import { fonts } from '../../theme/fonts';

/** Props for the TerminalInput component */
export interface TerminalInputProps {
  /** Called when the user submits a command (text includes trailing newline) */
  onSubmit: (text: string) => void;
}

/**
 * TerminalInput - Native text input with send button for terminal interaction.
 *
 * Renders a horizontal row with a TextInput (flex: 1) and a send icon button.
 * Terminal-appropriate settings: no autocorrect, no autocapitalize, no spellcheck.
 * The send button is accent-colored when text is present, muted when empty.
 *
 * @param props.onSubmit - Callback receiving the command text with trailing newline
 */
export function TerminalInput({ onSubmit }: TerminalInputProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius } = theme;
  const [text, setText] = useState('');

  /**
   * Handle submit from either the return key or send button press.
   * Appends newline so the PTY treats it as a command execution.
   * Clears input after submission.
   */
  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed + '\n');
    setText('');
  }, [text, onSubmit]);

  const hasText = text.trim().length > 0;

  return (
    <View
      style={[
        styles.container,
        {
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          backgroundColor: colors.bgSecondary,
        },
      ]}
    >
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: colors.bgElevated,
            color: colors.textPrimary,
            fontFamily: fonts.mono.regular,
            fontSize: theme.typography.sizes.sm,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
        value={text}
        onChangeText={setText}
        placeholder="Type a command..."
        placeholderTextColor={colors.textMuted}
        returnKeyType="send"
        blurOnSubmit={false}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        enablesReturnKeyAutomatically
        onSubmitEditing={handleSubmit}
      />
      <Pressable
        onPress={handleSubmit}
        style={[
          styles.sendButton,
          {
            marginLeft: spacing.sm,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Send command"
      >
        <Ionicons
          name="send"
          size={20}
          color={hasText ? colors.accent : colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 40,
  },
  sendButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
