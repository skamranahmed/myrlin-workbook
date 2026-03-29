/**
 * useSearch.ts - Debounced search hook with keyword and AI semantic modes.
 *
 * Provides a unified search interface that wraps TanStack Query with 300ms
 * input debouncing, mode toggling, and keepPreviousData behavior so results
 * stay visible while new ones load.
 *
 * Keyword mode calls the /api/search endpoint (JSONL grep).
 * AI mode calls /api/search-conversations (Anthropic semantic search).
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { SearchResult } from '@/types/api';

/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 300;

/** Minimum query length before triggering a search */
const MIN_QUERY_LENGTH = 2;

/** Search mode: keyword (local grep) or AI (semantic via Anthropic) */
export type SearchMode = 'keyword' | 'ai';

/** Options for the useSearch hook */
export interface UseSearchOptions {
  /** Search mode: keyword grep or AI semantic search */
  mode?: SearchMode;
  /** Optional workspace filter for scoping results */
  workspaceId?: string;
}

/** Return value from the useSearch hook */
export interface UseSearchResult {
  /** Current raw query string */
  query: string;
  /** Setter for the query string (pass to TextInput onChangeText) */
  setQuery: (q: string) => void;
  /** Search results array */
  results: SearchResult[];
  /** True while a search request is in flight */
  isLoading: boolean;
  /** True if the last search request failed */
  isError: boolean;
  /** Current search mode */
  searchMode: SearchMode;
  /** Setter for the search mode */
  setSearchMode: (mode: SearchMode) => void;
}

/**
 * useDebounce - Returns a debounced version of the input value.
 *
 * Updates the output value only after the input has been stable
 * for the specified delay period. Cleans up pending timers on unmount.
 *
 * @param value - The value to debounce
 * @param delay - Debounce delay in milliseconds
 * @returns The debounced value
 */
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * useSearch - Debounced search hook supporting keyword and AI modes.
 *
 * Wraps TanStack Query with input debouncing so the API is only hit
 * after 300ms of inactivity. Uses keepPreviousData so stale results
 * remain visible while fresh results load.
 *
 * @param options - Optional search configuration (mode, workspaceId)
 * @returns Search state and controls
 *
 * @example
 * ```tsx
 * const { query, setQuery, results, isLoading, searchMode, setSearchMode } = useSearch();
 * return <SearchBar value={query} onChangeText={setQuery} />;
 * ```
 */
export function useSearch(options?: UseSearchOptions): UseSearchResult {
  const client = useAPIClient();
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<SearchMode>(
    options?.mode ?? 'keyword'
  );

  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const workspaceId = options?.workspaceId;

  // Query is enabled only when we have a client and a meaningful query
  const enabled =
    !!client && debouncedQuery.length >= MIN_QUERY_LENGTH;

  const searchQuery = useQuery({
    queryKey: ['search', searchMode, debouncedQuery, workspaceId],
    queryFn: async () => {
      if (!client) return { results: [] };

      if (searchMode === 'ai') {
        return client.searchConversations({
          query: debouncedQuery,
          workspaceId,
        });
      }

      return client.search(debouncedQuery, 20);
    },
    enabled,
    staleTime: 30000,
    placeholderData: keepPreviousData,
  });

  return {
    query,
    setQuery,
    results: searchQuery.data?.results ?? [],
    isLoading: searchQuery.isLoading && enabled,
    isError: searchQuery.isError,
    searchMode,
    setSearchMode,
  };
}
