/**
 * costs/index.tsx - Cost dashboard screen with analytics, charts, and breakdowns.
 *
 * Full cost analytics dashboard replacing the placeholder. Displays:
 * - SegmentedControl for period selection (Today, 7d, 30d, All)
 * - Summary cards (total cost, period cost, avg/message, cache savings)
 * - Victory Native line chart for daily cost timeline
 * - Model breakdown with percentage bars
 * - Workspace breakdown with percentage bars
 * - Top 10 sessions ranked by cost
 *
 * Uses pull-to-refresh via RefreshControl. All sub-components receive
 * data as props (no internal fetching). Loading state shows skeleton
 * placeholders for cards and chart area.
 */

import React, { useCallback, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/useTheme';
import { useCostDashboard, type CostPeriod } from '@/hooks/useCosts';
import { SegmentedControl, Skeleton, EmptyState } from '@/components/ui';
import { CostSummaryCards } from '@/components/costs/CostSummaryCards';
import { CostTimeline } from '@/components/costs/CostTimeline';
import { ModelBreakdown } from '@/components/costs/ModelBreakdown';
import { WorkspaceBreakdown } from '@/components/costs/WorkspaceBreakdown';
import { TopSessions } from '@/components/costs/TopSessions';
import { fonts } from '@/theme/fonts';

/** Segment labels displayed in the SegmentedControl */
const PERIOD_LABELS = ['Today', '7d', '30d', 'All'];

/** Mapping from segment index to CostPeriod API values */
const PERIOD_VALUES: CostPeriod[] = ['day', 'week', 'month', 'all'];

/**
 * CostsScreen - Cost analytics dashboard tab.
 *
 * Manages period selection state and renders the full cost dashboard
 * with all sub-components. Handles loading, error, and empty states.
 */
export default function CostsScreen() {
  const { theme } = useTheme();
  const { colors, spacing } = theme;

  /** Currently selected period index (default: 1 = 'week') */
  const [periodIndex, setPeriodIndex] = useState(1);
  const period = PERIOD_VALUES[periodIndex];

  /** Cost dashboard query */
  const { data, isLoading, isError, refetch, isRefetching } =
    useCostDashboard(period);

  /** Pull-to-refresh handler */
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: colors.base }]}
    >
      {/* Header */}
      <View style={[styles.header, { paddingHorizontal: spacing.md }]}>
        <Text
          style={[
            styles.title,
            { color: colors.textPrimary, fontFamily: fonts.sans.bold },
          ]}
        >
          Costs
        </Text>
      </View>

      {/* Period Selector */}
      <View style={{ paddingHorizontal: spacing.md, marginBottom: spacing.sm }}>
        <SegmentedControl
          segments={PERIOD_LABELS}
          selectedIndex={periodIndex}
          onSelect={setPeriodIndex}
        />
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* Loading State */}
        {isLoading && (
          <View style={{ paddingHorizontal: spacing.md }}>
            {/* Skeleton summary cards */}
            <View style={styles.skeletonCards}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton
                  key={i}
                  width={130}
                  height={72}
                  borderRadius={12}
                />
              ))}
            </View>
            {/* Skeleton chart */}
            <View style={styles.skeletonChart}>
              <Skeleton width="100%" height={200} borderRadius={12} />
            </View>
            {/* Skeleton breakdown rows */}
            {Array.from({ length: 3 }).map((_, i) => (
              <View key={i} style={styles.skeletonRow}>
                <Skeleton width="60%" height={14} borderRadius={4} />
                <Skeleton width="100%" height={8} borderRadius={4} />
              </View>
            ))}
          </View>
        )}

        {/* Error State */}
        {isError && !isLoading && (
          <EmptyState
            title="Failed to Load"
            description="Could not fetch cost data from the server"
            action={{ label: 'Retry', onPress: handleRefresh }}
          />
        )}

        {/* Data State */}
        {data && !isLoading && (
          <>
            <CostSummaryCards summary={data.summary} />
            <CostTimeline timeline={data.timeline} />
            <ModelBreakdown byModel={data.byModel} />
            <WorkspaceBreakdown byWorkspace={data.byWorkspace} />
            <TopSessions sessions={data.sessions} />
            {/* Bottom spacing */}
            <View style={{ height: spacing.xxl }} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 24,
  },
  skeletonCards: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  skeletonChart: {
    marginBottom: 16,
  },
  skeletonRow: {
    marginBottom: 12,
    gap: 6,
  },
});
