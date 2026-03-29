/**
 * TerminalCarousel.tsx - Swipeable page view for navigating between terminal sessions.
 *
 * Uses react-native-pager-view for native page swiping with correct iOS/Android
 * physics and deceleration. Implements lazy WebView mounting: only the currently
 * active page gets a full TerminalScreen with WebView; all other pages show a
 * lightweight placeholder card with session name and status.
 *
 * This prevents memory issues from multiple xterm.js instances running
 * simultaneously. When the user swipes to a new page, the previous terminal
 * disposes its WebView/WebSocket and the new one mounts fresh.
 *
 * Page indicator dots at the bottom show the current position when there
 * are multiple sessions. Single-session mode renders TerminalScreen directly
 * without the PagerView wrapper for zero overhead.
 */

import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import PagerView from 'react-native-pager-view';
import type { PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../hooks/useTheme';
import { useSession } from '../../hooks/useSessions';
import { fonts } from '../../theme/fonts';
import { TerminalScreen } from './TerminalScreen';

/** Props for the TerminalCarousel component */
export interface TerminalCarouselProps {
  /** Array of session UUIDs to display in the carousel */
  sessionIds: string[];
  /** Index of the initially active page */
  initialIndex: number;
  /** Callback fired when the user swipes to a different page */
  onPageChange?: (index: number) => void;
}

/**
 * Placeholder view shown for non-active carousel pages.
 * Displays the session name and a hint to swipe. No WebView is mounted,
 * keeping memory usage minimal for inactive terminals.
 *
 * @param props - sessionId to look up session metadata
 */
function InactivePage({ sessionId }: { sessionId: string }) {
  const { theme } = useTheme();
  const { colors, spacing } = theme;
  const sessionQuery = useSession(sessionId);
  const sessionName = sessionQuery.data?.name ?? 'Session';

  return (
    <View style={[styles.inactivePage, { backgroundColor: colors.base }]}>
      <Ionicons name="terminal-outline" size={48} color={colors.surface2} />
      <Text
        style={[
          styles.inactiveTitle,
          { color: colors.textSecondary, fontFamily: fonts.sans.semibold },
        ]}
        numberOfLines={1}
      >
        {sessionName}
      </Text>
      <Text
        style={[
          styles.inactiveHint,
          { color: colors.textMuted, fontFamily: fonts.sans.regular },
        ]}
      >
        Swipe to activate
      </Text>
    </View>
  );
}

/**
 * PageIndicator - Dots showing the current page position in the carousel.
 * Only rendered when there are 2+ sessions.
 *
 * @param props - total page count and active index
 */
function PageIndicator({
  count,
  activeIndex,
}: {
  count: number;
  activeIndex: number;
}) {
  const { theme } = useTheme();
  const { colors } = theme;

  return (
    <View style={styles.indicatorContainer}>
      {Array.from({ length: count }, (_, i) => (
        <View
          key={i}
          style={[
            styles.dot,
            {
              backgroundColor: i === activeIndex ? colors.accent : colors.surface1,
            },
          ]}
        />
      ))}
    </View>
  );
}

/**
 * TerminalCarousel - Swipeable terminal session navigator with lazy mounting.
 *
 * Renders a PagerView where only the active page mounts its WebView. Swiping
 * to a new page disposes the previous terminal and mounts the new one. Page
 * indicator dots appear at the bottom when there are multiple sessions.
 *
 * If only one session ID is provided, renders a single TerminalScreen directly
 * without PagerView overhead.
 *
 * @param props - Session IDs, initial index, and optional page change callback
 */
export function TerminalCarousel({
  sessionIds,
  initialIndex,
  onPageChange,
}: TerminalCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const pagerRef = useRef<PagerView>(null);

  /**
   * Handle page selection events from PagerView.
   * Updates the active index and notifies the parent.
   */
  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const newIndex = event.nativeEvent.position;
      setActiveIndex(newIndex);
      onPageChange?.(newIndex);
    },
    [onPageChange]
  );

  // Single session: render directly without PagerView wrapper
  if (sessionIds.length <= 1) {
    return <TerminalScreen sessionId={sessionIds[0] ?? ''} />;
  }

  return (
    <View style={styles.container}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={initialIndex}
        onPageSelected={handlePageSelected}
        overdrag
      >
        {sessionIds.map((sid, index) => (
          <View key={sid} style={styles.page}>
            {index === activeIndex ? (
              <TerminalScreen sessionId={sid} isActive />
            ) : (
              <InactivePage sessionId={sid} />
            )}
          </View>
        ))}
      </PagerView>

      {/* Page indicator dots */}
      <PageIndicator count={sessionIds.length} activeIndex={activeIndex} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  inactivePage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  inactiveTitle: {
    fontSize: 18,
    maxWidth: '80%',
    textAlign: 'center',
  },
  inactiveHint: {
    fontSize: 14,
  },
  indicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
