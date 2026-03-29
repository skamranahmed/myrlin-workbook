/**
 * CostSummaryCards.tsx - Horizontal scrolling summary cards for cost metrics.
 *
 * Renders 4 cards in a horizontal ScrollView showing total cost, period cost,
 * average cost per message, and cache savings. Each card is ~120px wide with
 * surface0 background, themed text colors.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { fonts } from '@/theme/fonts';
import type { CostDashboardResponse } from '@/types/api';

/** Props for the CostSummaryCards component */
interface CostSummaryCardsProps {
  /** Summary data from the cost dashboard response */
  summary: CostDashboardResponse['summary'];
}

/**
 * Format a USD cost value to a readable string.
 * Values under $0.01 show 4 decimals, otherwise 2 decimals.
 *
 * @param value - Cost in USD
 * @param decimals - Number of decimal places (default 2)
 * @returns Formatted string like "$1.23"
 */
function formatCost(value: number, decimals = 2): string {
  return `$${value.toFixed(decimals)}`;
}

/**
 * CostSummaryCards - Horizontal card strip with key cost metrics.
 *
 * Shows Total Cost, Period Cost, Avg/Message, and Cache Savings
 * in a horizontally scrollable row of themed cards.
 *
 * @param props - Summary data from cost dashboard
 */
export function CostSummaryCards({ summary }: CostSummaryCardsProps) {
  const { theme } = useTheme();
  const { colors, radius, spacing } = theme;

  const cardStyle = {
    backgroundColor: colors.surface0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    width: 130,
    marginRight: spacing.sm,
  };

  const cards = [
    {
      label: 'Total Cost',
      value: formatCost(summary.totalCost),
    },
    {
      label: summary.periodLabel,
      value: formatCost(summary.periodCost),
    },
    {
      label: 'Avg / Message',
      value: formatCost(summary.avgCostPerMessage, 4),
    },
    {
      label: 'Cache Savings',
      value: `${formatCost(summary.cacheSavings)} saved`,
    },
  ];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.scrollContent, { paddingHorizontal: spacing.md }]}
    >
      {cards.map((card) => (
        <View key={card.label} style={cardStyle}>
          <Text
            style={[
              styles.value,
              { color: colors.textPrimary, fontFamily: fonts.sans.bold },
            ]}
            numberOfLines={1}
          >
            {card.value}
          </Text>
          <Text
            style={[
              styles.label,
              { color: colors.textSecondary, fontFamily: fonts.sans.regular },
            ]}
            numberOfLines={1}
          >
            {card.label}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingVertical: 8,
  },
  value: {
    fontSize: 18,
    marginBottom: 4,
  },
  label: {
    fontSize: 12,
  },
});
