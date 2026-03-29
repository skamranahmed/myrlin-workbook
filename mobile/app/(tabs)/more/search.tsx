/**
 * more/search.tsx - Full search screen with keyword and AI semantic modes.
 *
 * Provides a search interface for finding sessions by content. Supports
 * two modes via SegmentedControl: keyword search (server-side JSONL grep)
 * and AI semantic search (Anthropic-powered). Results are displayed in a
 * FlashList with session name, message preview, role badge, and timestamp.
 *
 * Data flow:
 *   User types -> useSearch debounces (300ms) -> TanStack Query fetches
 *   -> FlashList renders results with keepPreviousData for smooth UX
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useSearch, type SearchMode } from '@/hooks/useSearch';
import { fonts } from '@/theme/fonts';
import {
  SearchBar,
  SegmentedControl,
  Skeleton,
  EmptyState,
  Badge,
  Card,
} from '@/components/ui';
import type { SearchResult } from '@/types/api';

/** Segment labels for mode toggle */
const MODE_SEGMENTS = ['Keyword', 'AI Search'];

/**
 * Format a timestamp into a relative time string (e.g. "2h ago", "3d ago").
 *
 * @param timestamp - ISO timestamp string
 * @returns Human-readable relative time
 */
function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMonth = Math.floor(diffDay / 30);
  return `${diffMonth}mo ago`;
}

/**
 * SearchResultRow - Renders a single search result inside a Card.
 *
 * Shows session name (bold), message preview (up to 2 lines), role badge,
 * and relative timestamp. Tapping navigates to the session detail screen.
 *
 * @param props.item - The search result data
 * @param props.onPress - Callback when the row is pressed
 */
const SearchResultRow = React.memo(function SearchResultRow({
  item,
  onPress,
}: {
  item: SearchResult;
  onPress: (sessionId: string) => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={() => onPress(item.sessionId)}
      style={({ pressed }) => [
        styles.resultCard,
        {
          backgroundColor: theme.colors.surface0,
          borderColor: theme.colors.borderSubtle,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      {/* Session name and role badge row */}
      <View style={styles.resultHeader}>
        <Text
          style={[
            styles.sessionName,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.semibold,
            },
          ]}
          numberOfLines={1}
        >
          {item.sessionName}
        </Text>
        <Badge variant={item.role === 'assistant' ? 'info' : 'default'}>
          {item.role}
        </Badge>
      </View>

      {/* Message preview */}
      <Text
        style={[
          styles.messagePreview,
          {
            color: theme.colors.textSecondary,
            fontFamily: fonts.sans.regular,
          },
        ]}
        numberOfLines={2}
      >
        {item.message}
      </Text>

      {/* Timestamp */}
      <Text
        style={[
          styles.timestamp,
          {
            color: theme.colors.textMuted,
            fontFamily: fonts.sans.regular,
          },
        ]}
      >
        {formatRelativeTime(item.timestamp)}
      </Text>
    </Pressable>
  );
});

/**
 * SearchScreen - Full search screen accessible from the More tab.
 *
 * Layout (top to bottom):
 *   1. Back button + "Search" title header
 *   2. SearchBar input
 *   3. SegmentedControl: Keyword | AI Search
 *   4. FlashList of search results
 *   5. States: empty query hint, loading skeletons, no results, error
 */
export default function SearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { query, setQuery, results, isLoading, isError, searchMode, setSearchMode } =
    useSearch();

  /** Map segment index to search mode */
  const handleModeChange = useCallback(
    (index: number) => {
      const modes: SearchMode[] = ['keyword', 'ai'];
      setSearchMode(modes[index]);
    },
    [setSearchMode]
  );

  /** Navigate to session detail on result press */
  const handleResultPress = useCallback(
    (sessionId: string) => {
      router.push(`/sessions/${sessionId}` as any);
    },
    [router]
  );

  /** Render a single search result row */
  const renderItem = useCallback(
    ({ item }: { item: SearchResult }) => (
      <SearchResultRow item={item} onPress={handleResultPress} />
    ),
    [handleResultPress]
  );

  const keyExtractor = useCallback((item: SearchResult) => {
    return `${item.sessionId}-${item.timestamp}`;
  }, []);

  const modeIndex = searchMode === 'keyword' ? 0 : 1;

  /** Determine which content state to show */
  const renderContent = () => {
    // No query: show hint
    if (query.length < 2) {
      return (
        <EmptyState
          icon={
            <Ionicons
              name="search-outline"
              size={48}
              color={theme.colors.textMuted}
            />
          }
          title="Search sessions"
          description="Search by keyword across session content, or use AI search for semantic matching."
        />
      );
    }

    // Loading: skeleton placeholders
    if (isLoading) {
      return (
        <View style={styles.skeletonContainer}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <Skeleton width="100%" height={88} />
            </View>
          ))}
        </View>
      );
    }

    // Error state
    if (isError) {
      return (
        <EmptyState
          icon={
            <Ionicons
              name="warning-outline"
              size={48}
              color={theme.colors.error}
            />
          }
          title="Search failed"
          description="Could not complete the search. Check your connection and try again."
          action={{
            label: 'Retry',
            onPress: () => setQuery(query),
          }}
        />
      );
    }

    // No results
    if (results.length === 0) {
      return (
        <EmptyState
          icon={
            <Ionicons
              name="document-outline"
              size={48}
              color={theme.colors.textMuted}
            />
          }
          title={`No results for "${query}"`}
          description={
            searchMode === 'keyword'
              ? 'Try different keywords or switch to AI search for semantic matching.'
              : 'Try rephrasing your query or switch to keyword search.'
          }
        />
      );
    }

    // Results list
    return (
      <FlashList
        data={results}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
      />
    );
  };

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* Header with back button */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons
            name="chevron-back"
            size={24}
            color={theme.colors.textPrimary}
          />
        </Pressable>
        <Text
          style={[
            styles.title,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.semibold,
            },
          ]}
        >
          Search
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Search bar */}
      <View style={styles.searchBarContainer}>
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder={
            searchMode === 'keyword'
              ? 'Search by keyword...'
              : 'Describe what you are looking for...'
          }
        />
      </View>

      {/* Mode toggle */}
      <View style={styles.segmentContainer}>
        <SegmentedControl
          segments={MODE_SEGMENTS}
          selectedIndex={modeIndex}
          onSelect={handleModeChange}
        />
      </View>

      {/* Content area */}
      <View style={styles.contentArea}>{renderContent()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  title: {
    fontSize: 22,
    flex: 1,
  },
  headerSpacer: {
    width: 24,
  },
  searchBarContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  segmentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  contentArea: {
    flex: 1,
  },
  resultCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sessionName: {
    fontSize: 15,
    flex: 1,
    marginRight: 8,
  },
  messagePreview: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 4,
  },
  timestamp: {
    fontSize: 11,
  },
  skeletonContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 8,
  },
  skeletonCard: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  listContent: {
    paddingTop: 4,
    paddingBottom: 16,
  },
});
