/**
 * CostTimeline.tsx - Victory Native v2 line chart for daily cost trends.
 *
 * Renders a CartesianChart with a Line component showing cost over time.
 * Uses the v2 API (CartesianChart, Line, CartesianAxis) rather than
 * legacy Victory components. Shows an EmptyState when there is no
 * timeline data for the selected period.
 */

import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { CartesianChart, Line } from 'victory-native';

import { useTheme } from '@/hooks/useTheme';
import { SectionHeader, EmptyState } from '@/components/ui';
import type { CostDashboardResponse } from '@/types/api';

/** Props for the CostTimeline component */
interface CostTimelineProps {
  /** Timeline data points from the cost dashboard */
  timeline: CostDashboardResponse['timeline'];
}

/**
 * Format a YYYY-MM-DD date string to MM/DD for chart axis labels.
 *
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Formatted date like "03/28"
 */
function formatDateLabel(dateStr: string): string {
  const parts = dateStr.split('-');
  return `${parts[1]}/${parts[2]}`;
}

/**
 * CostTimeline - Daily cost trend line chart using Victory Native v2.
 *
 * Renders a CartesianChart with a Line component. X-axis maps to
 * day indices, Y-axis to cost in USD. Line color uses the theme
 * accent (Catppuccin mauve). If the timeline is empty, shows an
 * EmptyState placeholder.
 *
 * @param props - Timeline data from cost dashboard
 */
export function CostTimeline({ timeline }: CostTimelineProps) {
  const { theme } = useTheme();
  const { colors, spacing } = theme;

  /** Map timeline entries to chart data points */
  const chartData = useMemo(
    () =>
      timeline.map((entry, index) => ({
        day: index,
        cost: entry.cost,
        label: formatDateLabel(entry.date),
      })),
    [timeline]
  );

  if (timeline.length === 0) {
    return (
      <View style={styles.section}>
        <SectionHeader title="Cost Timeline" />
        <EmptyState
          title="No Data"
          description="No cost data for this period"
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeader title="Cost Timeline" />
      <View style={[styles.chartContainer, { paddingHorizontal: spacing.sm }]}>
        <CartesianChart
          data={chartData}
          xKey="day"
          yKeys={['cost']}
          domainPadding={{ top: 16, bottom: 8, left: 8, right: 8 }}
          axisOptions={{
            font: null,
            tickCount: { x: Math.min(timeline.length, 6), y: 4 },
            formatXLabel: (value: number) => {
              const idx = Math.round(value);
              return chartData[idx] ? chartData[idx].label : '';
            },
            formatYLabel: (value: number) => `$${value.toFixed(2)}`,
            labelColor: colors.textSecondary,
            lineColor: colors.surface1,
          }}
        >
          {({ points }) => (
            <Line
              points={points.cost}
              color={colors.accent}
              strokeWidth={2}
              curveType="natural"
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
  },
  chartContainer: {
    height: 200,
    overflow: 'hidden',
  },
});
