/**
 * ui-store.ts - Zustand store for transient UI preferences.
 *
 * Manages non-persisted UI state like the active workspace filter,
 * session sort order, and other view preferences. This store does NOT
 * use persistence middleware since these are ephemeral session preferences
 * that reset on app launch.
 */

import { create } from 'zustand';

/** Possible sort orders for the session list */
export type SessionSortOrder = 'recent' | 'name' | 'status';

/** Store state shape */
interface UIStoreState {
  /** Currently selected workspace filter (null means "All") */
  selectedWorkspaceFilter: string | null;
  /** Current sort order for the session list */
  sessionSortOrder: SessionSortOrder;
}

/** Store actions */
interface UIStoreActions {
  /**
   * Set the workspace filter for the session list.
   * Pass null to show all sessions ("All" filter).
   * @param id - Workspace ID or null
   */
  setWorkspaceFilter: (id: string | null) => void;

  /**
   * Set the sort order for the session list.
   * @param order - Sort order: "recent", "name", or "status"
   */
  setSessionSortOrder: (order: SessionSortOrder) => void;
}

/**
 * useUIStore - Zustand store for transient UI preferences.
 *
 * No persistence. State resets on app launch. Use for view-level
 * settings that don't need to survive app restarts.
 *
 * @example
 * ```ts
 * const filter = useUIStore((s) => s.selectedWorkspaceFilter);
 * const setFilter = useUIStore((s) => s.setWorkspaceFilter);
 * ```
 */
export const useUIStore = create<UIStoreState & UIStoreActions>()((set) => ({
  // ─── State ─────────────────────────────────────────────
  selectedWorkspaceFilter: null,
  sessionSortOrder: 'recent',

  // ─── Actions ───────────────────────────────────────────

  setWorkspaceFilter: (id) => {
    set({ selectedWorkspaceFilter: id });
  },

  setSessionSortOrder: (order) => {
    set({ sessionSortOrder: order });
  },
}));
