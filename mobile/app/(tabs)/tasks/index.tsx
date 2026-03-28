/**
 * tasks/index.tsx - Tasks kanban screen (placeholder).
 *
 * Displays a centered label with themed styling. Will be replaced
 * with the kanban board in Phase 5.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';

/**
 * TasksScreen - Placeholder for the tasks kanban tab.
 */
export default function TasksScreen() {
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
          Tasks
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
          Kanban board for workspace tasks
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
