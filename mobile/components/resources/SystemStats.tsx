/**
 * SystemStats.tsx - System-level CPU and memory overview cards.
 *
 * Displays two side-by-side cards: CPU usage with percentage and core count,
 * and memory usage with a proportional progress bar. Below the cards shows
 * uptime, total Claude CPU%, and total Claude memory.
 *
 * Color-coded CPU: green < 50%, yellow 50-80%, red > 80%.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import type { ResourceMetrics } from '@/types/api';

/** Props for the SystemStats component */
interface SystemStatsProps {
  /** Resource metrics data from the server */
  data: ResourceMetrics;
}

/**
 * Format seconds into a human-readable "Xd Xh Xm" string.
 * @param seconds - Uptime in seconds
 * @returns Formatted uptime string
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/**
 * Get the color for a CPU usage percentage.
 * Green below 50%, yellow 50-80%, red above 80%.
 * @param percent - CPU usage percentage (0-100)
 * @param colors - Theme color palette
 * @returns Hex color string
 */
function getCpuColor(
  percent: number,
  colors: { green: string; yellow: string; red: string }
): string {
  if (percent < 50) return colors.green;
  if (percent < 80) return colors.yellow;
  return colors.red;
}

/**
 * SystemStats - Displays system CPU and memory overview.
 *
 * Two cards side-by-side: CPU with percentage and core count,
 * Memory with progress bar and used/total. Below shows uptime
 * and aggregate Claude session resource usage.
 *
 * @param props.data - Resource metrics from the server
 */
export function SystemStats({ data }: SystemStatsProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius, typography } = theme;

  const cpuPercent = Math.round(data.system.cpuUsage);
  const cpuColor = getCpuColor(cpuPercent, colors);
  const memPercent = data.system.totalMemoryMB > 0
    ? Math.round((data.system.usedMemoryMB / data.system.totalMemoryMB) * 100)
    : 0;
  const memColor = getCpuColor(memPercent, colors);

  return (
    <View style={styles.container}>
      {/* CPU and Memory cards side by side */}
      <View style={styles.cardRow}>
        {/* CPU Card */}
        <Card style={{ ...styles.card, backgroundColor: colors.surface0 }}>
          <Text style={[styles.cardLabel, { color: colors.textSecondary, fontFamily: typography.fontSans }]}>
            CPU
          </Text>
          <Text style={[styles.percentText, { color: cpuColor, fontFamily: typography.fontMono }]}>
            {cpuPercent}%
          </Text>
          <Text style={[styles.subLabel, { color: colors.textTertiary, fontFamily: typography.fontSans }]}>
            {data.system.cpuCount} cores
          </Text>
        </Card>

        {/* Memory Card */}
        <Card style={{ ...styles.card, backgroundColor: colors.surface0 }}>
          <Text style={[styles.cardLabel, { color: colors.textSecondary, fontFamily: typography.fontSans }]}>
            Memory
          </Text>
          <Text style={[styles.percentText, { color: memColor, fontFamily: typography.fontMono }]}>
            {memPercent}%
          </Text>
          {/* Progress bar */}
          <View style={[styles.progressTrack, { backgroundColor: colors.surface1, borderRadius: radius.sm }]}>
            <View
              style={[
                styles.progressFill,
                {
                  backgroundColor: memColor,
                  width: `${Math.min(memPercent, 100)}%`,
                  borderRadius: radius.sm,
                },
              ]}
            />
          </View>
          <Text style={[styles.subLabel, { color: colors.textTertiary, fontFamily: typography.fontMono }]}>
            {Math.round(data.system.usedMemoryMB)} / {Math.round(data.system.totalMemoryMB)} MB
          </Text>
        </Card>
      </View>

      {/* Summary row: uptime, Claude totals */}
      <View style={[styles.summaryRow, { backgroundColor: colors.surface0, borderRadius: radius.md }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.textTertiary, fontFamily: typography.fontSans }]}>
            Uptime
          </Text>
          <Text style={[styles.summaryValue, { color: colors.textPrimary, fontFamily: typography.fontMono }]}>
            {formatUptime(data.system.uptimeSeconds)}
          </Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.surface1 }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.textTertiary, fontFamily: typography.fontSans }]}>
            Claude CPU
          </Text>
          <Text style={[styles.summaryValue, { color: colors.accent, fontFamily: typography.fontMono }]}>
            {Math.round(data.totalClaudeCpuPercent)}%
          </Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: colors.surface1 }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: colors.textTertiary, fontFamily: typography.fontSans }]}>
            Claude Mem
          </Text>
          <Text style={[styles.summaryValue, { color: colors.accent, fontFamily: typography.fontMono }]}>
            {Math.round(data.totalClaudeMemoryMB)} MB
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  card: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
    gap: 4,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  percentText: {
    fontSize: 32,
    fontWeight: '700',
    marginVertical: 4,
  },
  subLabel: {
    fontSize: 12,
    marginTop: 2,
  },
  progressTrack: {
    width: '100%',
    height: 6,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  summaryDivider: {
    width: 1,
    height: 28,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
  },
});
