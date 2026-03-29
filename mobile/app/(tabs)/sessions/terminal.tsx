/**
 * sessions/terminal.tsx - Route screen for the terminal view.
 *
 * Supports two modes:
 *   1. Single session: renders TerminalScreen directly (no carousel overhead)
 *   2. Carousel mode: renders TerminalCarousel when multiple running session IDs
 *      are provided via the sessionIds search param
 *
 * The sessionIds param is a comma-separated string of session UUIDs, passed
 * from the session detail screen when the user opens a terminal. This enables
 * swiping between all running sessions without navigating back to the list.
 *
 * Navigation: /sessions/terminal?id={sessionId}&sessionIds={id1,id2,id3}
 */

import { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { TerminalScreen } from '@/components/terminal/TerminalScreen';
import { TerminalCarousel } from '@/components/terminal/TerminalCarousel';

/**
 * TerminalRoute - Expo Router screen for terminal view.
 *
 * Reads the `id` and optional `sessionIds` search parameters. If sessionIds
 * contains multiple IDs, renders a TerminalCarousel for swipeable navigation.
 * Otherwise renders a single TerminalScreen.
 *
 * The initial page index in the carousel is determined by finding the
 * position of `id` within the sessionIds array.
 */
export default function TerminalRoute() {
  const { id, sessionIds: sessionIdsParam } = useLocalSearchParams<{
    id: string;
    sessionIds?: string;
  }>();

  /**
   * Parse the comma-separated sessionIds string into an array.
   * Falls back to a single-element array containing just the id param.
   */
  const sessionIds = useMemo(() => {
    if (sessionIdsParam) {
      const ids = sessionIdsParam.split(',').filter(Boolean);
      if (ids.length > 0) {
        return ids;
      }
    }
    return [id ?? ''];
  }, [sessionIdsParam, id]);

  /**
   * Find the initial page index by locating the current session ID
   * within the full sessionIds array. Defaults to 0 if not found.
   */
  const initialIndex = useMemo(() => {
    const idx = sessionIds.indexOf(id ?? '');
    return idx >= 0 ? idx : 0;
  }, [sessionIds, id]);

  // Single session: render directly without carousel wrapper
  if (sessionIds.length <= 1) {
    return <TerminalScreen sessionId={sessionIds[0] ?? ''} />;
  }

  // Multiple sessions: render carousel for swipeable navigation
  return (
    <TerminalCarousel
      sessionIds={sessionIds}
      initialIndex={initialIndex}
    />
  );
}
