/**
 * resources.tsx - Resource monitor screen in the More tab.
 *
 * Displays system CPU/memory stats and per-session resource consumption.
 * Auto-refreshes every 10 seconds via the useResources hook for live
 * monitoring. Supports pull-to-refresh and shows a pulsing "Live" indicator.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton, EmptyState } from '@/components/ui';
import { SystemStats } from '@/components/resources/SystemStats';
import { SessionResources } from '@/components/resources/SessionResources';
import { useResources } from '@/hooks/useResources';
import { useTheme } from '@/hooks/useTheme';

/**
 * PulsingDot - A small green dot that pulses to indicate live data.
 * Uses Reanimated for smooth opacity animation.
 */
function PulsingDot() {
  const { theme } = useTheme();
  const opacity = useSharedValue(1);

  React.useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [opacity]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.liveDot,
        { backgroundColor: theme.colors.green },
        animStyle,
      ]}
    />
  );
}

/**
 * ResourcesScreen - Main resource monitor screen.
 *
 * Shows system overview (CPU, memory, uptime) at top and a per-session
 * resource list below. Supports pull-to-refresh and displays loading
 * skeletons while data is being fetched. A "Live" badge with a pulsing
 * green dot indicates auto-refresh is active.
 */
export default function ResourcesScreen() {
  const { theme } = useTheme();
  const { colors, spacing, typography, radius } = theme;
  const { data, isLoading, isError, refetch, isRefetching } = useResources();

  /** Handle pull-to-refresh */
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.base }]} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { padding: spacing.md }]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={handleRefresh}
            tintColor={colors.accent}
          />
        }
      >
        {/* Header with title and live indicator */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary, fontFamily: typography.fontSans }]}>
            Resources
          </Text>
          <View style={[styles.liveBadge, { backgroundColor: colors.green + '18', borderRadius: radius.full }]}>
            <PulsingDot />
            <Text style={[styles.liveText, { color: colors.green, fontFamily: typography.fontSans }]}>
              Live
            </Text>
          </View>
        </View>

        {/* Loading state */}
        {isLoading && (
          <View style={styles.skeletonContainer}>
            <View style={styles.skeletonRow}>
              <Skeleton width="48%" height={120} />
              <Skeleton width="48%" height={120} />
            </View>
            <Skeleton width="100%" height={48} />
            <Skeleton width="100%" height={80} />
            <Skeleton width="100%" height={80} />
          </View>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <EmptyState
            icon={<Ionicons name="warning-outline" size={32} color={colors.textTertiary} />}
            title="Failed to Load Resources"
            description="Could not connect to the server. Pull down to retry."
          />
        )}

        {/* Data loaded */}
        {data && !isLoading && (
          <>
            <SystemStats data={data} />
            <SessionResources sessions={data.claudeSessions} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 32,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  liveText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  skeletonContainer: {
    gap: 12,
  },
  skeletonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
