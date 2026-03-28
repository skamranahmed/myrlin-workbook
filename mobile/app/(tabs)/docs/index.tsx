/**
 * docs/index.tsx - Documents list screen (placeholder).
 *
 * Displays a centered label with themed styling. Will be replaced
 * with the workspace docs viewer in Phase 6.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/**
 * DocsScreen - Placeholder for the documents list tab.
 */
export default function DocsScreen() {
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
          Docs
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
          Workspace notes, goals, and rules
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
