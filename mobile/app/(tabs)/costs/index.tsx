/**
 * costs/index.tsx - Cost dashboard screen (placeholder).
 *
 * Displays a centered label with themed styling. Will be replaced
 * with the cost analytics dashboard in Phase 5.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/**
 * CostsScreen - Placeholder for the cost dashboard tab.
 */
export default function CostsScreen() {
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
          Costs
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
          Token usage and cost analytics
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
