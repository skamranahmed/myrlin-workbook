/**
 * useToast.ts - Global toast notification state managed by Zustand.
 *
 * Provides a single source of truth for toast visibility, message, and
 * variant. The root layout renders one Toast component wired to this store,
 * and any component (or non-React code) can trigger a toast via the
 * standalone showToast() function.
 *
 * Existing screens that render their own local <Toast> components are
 * unaffected; this global toast is additive for push notification toasts
 * and future centralized toast use.
 */

import { create } from 'zustand';
import type { ToastVariant } from '@/components/ui/Toast';

/** Toast state shape */
interface ToastState {
  /** Whether the toast is currently showing */
  visible: boolean;
  /** Message text to display */
  message: string;
  /** Color variant (success, error, info, warning) */
  variant: ToastVariant;
}

/** Toast actions */
interface ToastActions {
  /** Show a toast with the given message and optional variant */
  showToast: (message: string, variant?: ToastVariant) => void;
  /** Hide the currently visible toast */
  hideToast: () => void;
}

/**
 * Zustand store for global toast state.
 * Not persisted; resets on app restart.
 *
 * @example
 * ```tsx
 * // Inside a React component
 * const { visible, message, variant, hideToast } = useToastStore();
 *
 * // Outside React (e.g. in a service or callback)
 * import { showToast } from '@/hooks/useToast';
 * showToast('Session started', 'success');
 * ```
 */
export const useToastStore = create<ToastState & ToastActions>()((set) => ({
  visible: false,
  message: '',
  variant: 'info' as ToastVariant,

  /**
   * Display a toast notification at the root level.
   * @param message - Text to show
   * @param variant - Color variant, defaults to 'info'
   */
  showToast: (message: string, variant: ToastVariant = 'info') => {
    set({ visible: true, message, variant });
  },

  /**
   * Dismiss the currently visible toast.
   * Called by the Toast component's onDismiss callback.
   */
  hideToast: () => {
    set({ visible: false });
  },
}));

/**
 * Standalone function to show a toast from anywhere (including non-React code).
 * Reads the store state directly without needing a hook.
 *
 * @param message - Text to display
 * @param variant - Color variant, defaults to 'info'
 */
export function showToast(message: string, variant: ToastVariant = 'info'): void {
  useToastStore.getState().showToast(message, variant);
}
