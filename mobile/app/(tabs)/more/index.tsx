/**
 * more/index.tsx - More menu screen (placeholder).
 *
 * Displays a centered label with themed styling. Will be replaced
 * with settings, server management, and additional options in Phase 6.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/**
 * MoreScreen - Placeholder for the more/settings tab.
 */
export default function MoreScreen() {
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
          More
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
          Settings, servers, and preferences
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
