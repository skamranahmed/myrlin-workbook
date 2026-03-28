/**
 * sessions/index.tsx - Sessions list screen (placeholder).
 *
 * Displays a centered label with themed styling. Will be replaced
 * with the full session list in Phase 3.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/**
 * SessionsScreen - Placeholder for the sessions list tab.
 */
export default function SessionsScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      <View style={styles.center}>
        <Text
          style={[
            styles.label,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.semibold,
            },
          ]}
        >
          Sessions
        </Text>
        <Text
          style={[
            styles.sublabel,
            {
              color: theme.colors.textSecondary,
              fontFamily: fonts.sans.regular,
            },
          ]}
        >
          Your Claude Code sessions will appear here
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  label: {
    fontSize: 22,
    marginBottom: 8,
  },
  sublabel: {
    fontSize: 15,
    textAlign: 'center',
  },
});
