/**
 * ModelBreakdown.tsx - Cost breakdown by AI model with percentage bars.
 *
 * Renders a vertical list of models sorted by cost descending. Each row
 * shows the model name (monospace), cost amount, and a horizontal
 * percentage bar filled proportionally.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { SectionHeader } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import type { CostDashboardResponse } from '@/types/api';

/** Props for the ModelBreakdown component */
interface ModelBreakdownProps {
  /** Model breakdown entries from the cost dashboard */
  byModel: CostDashboardResponse['byModel'];
}

/**
 * ModelBreakdown - List of models with cost and percentage bars.
 *
 * Each row displays the model name (truncated, mono font), the cost
 * in USD, and a proportional bar. The bar width is based on the
 * percentage field (0-100) from the server response.
 *
 * @param props - Model breakdown data from cost dashboard
 */
export function ModelBreakdown({ byModel }: ModelBreakdownProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius } = theme;

  if (byModel.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="By Model" />
      <View style={{ paddingHorizontal: spacing.md }}>
        {byModel.map((entry) => (
          <View key={entry.model} style={styles.row}>
            <View style={styles.labelRow}>
              <Text
                style={[
                  styles.modelName,
                  { color: colors.textPrimary, fontFamily: fonts.mono.regular },
                ]}
                numberOfLines={1}
              >
                {entry.model}
              </Text>
              <Text
                style={[
                  styles.costText,
                  { color: colors.textSecondary, fontFamily: fonts.sans.medium },
                ]}
              >
                ${entry.cost.toFixed(2)}
              </Text>
            </View>
            <View style={[styles.barBackground, { backgroundColor: colors.surface1, borderRadius: radius.sm }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.min(entry.pct, 100)}%`,
                    backgroundColor: colors.accent,
                    borderRadius: radius.sm,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.pctText,
                { color: colors.textTertiary, fontFamily: fonts.sans.regular },
              ]}
            >
              {entry.pct.toFixed(1)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
  },
  row: {
    marginBottom: 12,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  modelName: {
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  costText: {
    fontSize: 13,
  },
  barBackground: {
    height: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
  },
  pctText: {
    fontSize: 11,
    marginTop: 2,
  },
});
