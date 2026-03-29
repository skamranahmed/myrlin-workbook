/**
 * TopSessions.tsx - Top sessions ranked by cost with token bar visualization.
 *
 * Renders a list of the top 10 sessions ordered by cost. Each item shows
 * session name, workspace name, model chip, cost badge, message count,
 * and a proportional bar indicating relative cost vs the most expensive session.
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { Card, Badge, Chip, SectionHeader } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import type { CostDashboardResponse } from '@/types/api';

/** Props for the TopSessions component */
interface TopSessionsProps {
  /** Sessions array from the cost dashboard (already sorted by cost desc) */
  sessions: CostDashboardResponse['sessions'];
}

/**
 * TopSessions - Ranked list of the top 10 most expensive sessions.
 *
 * Each session card shows: name, workspace, model (as a Chip), cost (as a Badge),
 * message count, and a proportional bar showing relative cost. The bar width
 * is computed as session cost / max cost in the list.
 *
 * @param props - Sessions data from cost dashboard
 */
export function TopSessions({ sessions }: TopSessionsProps) {
  const { theme } = useTheme();
  const { colors, spacing, radius } = theme;

  /** Limit to first 10 sessions */
  const topSessions = useMemo(
    () => sessions.slice(0, 10),
    [sessions]
  );

  /** Max cost for relative bar width calculation */
  const maxCost = useMemo(
    () => Math.max(...topSessions.map((s) => s.cost), 0.01),
    [topSessions]
  );

  if (topSessions.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title="Top Sessions" />
      <View style={{ paddingHorizontal: spacing.md, gap: spacing.sm }}>
        {topSessions.map((session, index) => (
          <Card key={session.id}>
            <View style={styles.header}>
              <View style={styles.titleArea}>
                <Text
                  style={[
                    styles.sessionName,
                    { color: colors.textPrimary, fontFamily: fonts.sans.semibold },
                  ]}
                  numberOfLines={1}
                >
                  {`#${index + 1} `}{session.name}
                </Text>
                <Text
                  style={[
                    styles.workspaceName,
                    { color: colors.textSecondary, fontFamily: fonts.sans.regular },
                  ]}
                  numberOfLines={1}
                >
                  {session.workspaceName}
                </Text>
              </View>
              <Badge variant="info">{`$${session.cost.toFixed(2)}`}</Badge>
            </View>

            <View style={styles.metaRow}>
              <Chip label={session.model} />
              <Text
                style={[
                  styles.messageCount,
                  { color: colors.textTertiary, fontFamily: fonts.sans.regular },
                ]}
              >
                {session.messageCount} msgs
              </Text>
            </View>

            {/* Proportional cost bar */}
            <View
              style={[
                styles.barBackground,
                { backgroundColor: colors.surface1, borderRadius: radius.sm },
              ]}
            >
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${Math.min((session.cost / maxCost) * 100, 100)}%`,
                    backgroundColor: colors.accent,
                    borderRadius: radius.sm,
                  },
                ]}
              />
            </View>
          </Card>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  titleArea: {
    flex: 1,
    marginRight: 8,
  },
  sessionName: {
    fontSize: 14,
  },
  workspaceName: {
    fontSize: 12,
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  messageCount: {
    fontSize: 12,
  },
  barBackground: {
    height: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
  },
});
