/**
 * useCosts.ts - TanStack Query hook for cost dashboard data.
 *
 * Provides a query hook that fetches the full cost dashboard response
 * (summary, timeline, model/workspace breakdowns, top sessions) from
 * the server. Uses a 30s staleTime since cost data changes less
 * frequently than session state.
 */

import { useQuery } from '@tanstack/react-query';
import { useAPIClient } from './useAPIClient';
import type { CostPeriod } from '@/types/api';

/** Re-export CostPeriod for consumer convenience */
export type { CostPeriod } from '@/types/api';

/**
 * useCostDashboard - Fetch cost dashboard data for a given time period.
 *
 * Returns the full CostDashboardResponse including summary cards, timeline
 * chart data, model breakdown, workspace breakdown, and top sessions.
 *
 * @param period - Time period filter (day, week, month, all)
 * @returns TanStack Query result with CostDashboardResponse data
 *
 * @example
 * ```ts
 * const { data, isLoading, refetch } = useCostDashboard('week');
 * if (data) {
 *   console.log(`Total cost: $${data.summary.totalCost}`);
 * }
 * ```
 */
export function useCostDashboard(period: CostPeriod) {
  const client = useAPIClient();

  return useQuery({
    queryKey: ['cost-dashboard', period],
    queryFn: () => client!.getCostDashboard(period),
    enabled: !!client,
    staleTime: 30000,
  });
}
