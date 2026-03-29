/**
 * WorkspaceBreakdown.tsx - Cost breakdown by workspace with percentage bars.
 *
 * Renders a vertical list of workspaces sorted by cost descending. Each row
 * shows the workspace name, session count badge, cost amount, and a
 * horizontal percentage bar.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { SectionHeader, Badge } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import type { CostDashboardResponse } from '@/types/api';

/** Props for the WorkspaceBreakdown component */
interface WorkspaceBreakdownProps {
  /** Workspace breakdown entries from the cost dashboard */
  byWorkspace: CostDashboardResponse['byWorkspace'];
}

/**
 * WorkspaceBreakdown - List of workspaces with cost and percentage bars.
 *
 * Each row displays the workspace name, a badge showing session count,
 * the cost in USD, and a proportional bar. Bar width is based on the
 * percentage field (0-100) from the server response.
 *
 * @param props - Workspace breakdown data from cost dashboard
 */
export function WorkspaceBreakdown({ byWorkspace }: WorkspaceBreakdownProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius } = theme;

  if (byWorkspace.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="By Workspace" />
      <View style={{ paddingHorizontal: spacing.md }}>
        {byWorkspace.map((entry) => (
          <View key={entry.id} style={styles.row}>
            <View style={styles.labelRow}>
              <View style={styles.nameContainer}>
                <Text
                  style={[
                    styles.workspaceName,
                    { color: colors.textPrimary, fontFamily: fonts.sans.medium },
                  ]}
                  numberOfLines={1}
                >
                  {entry.name}
                </Text>
                <Badge variant="default">{`${entry.sessionCount} sessions`}</Badge>
              </View>
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
  nameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
    marginRight: 8,
  },
  workspaceName: {
    fontSize: 14,
    flexShrink: 1,
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
