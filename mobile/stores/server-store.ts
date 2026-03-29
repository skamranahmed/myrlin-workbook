/**
 * server-store.ts - Zustand store for multi-server connection management.
 *
 * Manages the list of paired Myrlin servers, tracks the active server,
 * and persists everything to SecureStore (encrypted on-device storage).
 *
 * Pattern: Zustand 5 + persist middleware + SecureStore adapter.
 * Follows the same structure as theme-store.ts but uses async SecureStore
 * instead of synchronous MMKV.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createSecureStorage } from './secure-storage-adapter';
import type { ServerConnection, ConnectionStatus } from '../types/api';

/**
 * Generate a UUID v4 using Math.random (sufficient for local IDs).
 * @returns A UUID v4 string
 */
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Store state shape */
interface ServerStoreState {
  /** All paired servers */
  servers: ServerConnection[];
  /** ID of the currently active server (null if none) */
  activeServerId: string | null;
  /** Connection status of the active server */
  connectionStatus: ConnectionStatus;
  /** Whether the store has completed hydration from SecureStore */
  _hasHydrated: boolean;
  /** Current Expo push token for this device (transient, not persisted) */
  pushToken: string | null;
}

/** Store actions */
interface ServerStoreActions {
  /** Get the currently active server connection (derived) */
  getActiveServer: () => ServerConnection | null;
  /** Add a new paired server and set it as active */
  addServer: (data: Omit<ServerConnection, 'id' | 'pairedAt' | 'lastConnected'>) => void;
  /** Remove a server by ID; falls back active to first remaining or null */
  removeServer: (id: string) => void;
  /** Switch the active server to a different one by ID */
  switchServer: (id: string) => void;
  /** Rename a server by ID */
  renameServer: (id: string, name: string) => void;
  /** Update the connection status of the active server */
  setConnectionStatus: (status: ConnectionStatus) => void;
  /** Update the Bearer token for a specific server */
  updateToken: (serverId: string, token: string) => void;
  /** Clear the token for a server and disconnect if it was active */
  logout: (serverId: string) => void;
  /** Set the hydration completion flag */
  setHasHydrated: (val: boolean) => void;
  /** Store the current device push token (or clear it with null) */
  setPushToken: (token: string | null) => void;
}

/**
 * Server store hook with SecureStore-backed encrypted persistence.
 *
 * Usage:
 * ```ts
 * const { servers, activeServerId, addServer, removeServer } = useServerStore();
 * const activeServer = useServerStore(s => s.getActiveServer());
 * ```
 *
 * Only `servers` and `activeServerId` are persisted. Connection status
 * and hydration flags are transient (reset on app launch).
 */
export const useServerStore = create<ServerStoreState & ServerStoreActions>()(
  persist(
    (set, get) => ({
      // ─── State ─────────────────────────────────────
      servers: [],
      activeServerId: null,
      connectionStatus: 'disconnected' as ConnectionStatus,
      _hasHydrated: false,
      pushToken: null,

      // ─── Derived ───────────────────────────────────

      /**
       * Compute the active server from the servers array and activeServerId.
       * @returns The active ServerConnection or null
       */
      getActiveServer: (): ServerConnection | null => {
        const { servers, activeServerId } = get();
        if (!activeServerId) return null;
        return servers.find((s) => s.id === activeServerId) ?? null;
      },

      // ─── Actions ───────────────────────────────────

      /**
       * Add a new server connection after successful pairing.
       * Generates a UUID, sets timestamps, and activates the new server.
       * @param data - Server data without id, pairedAt, or lastConnected
       */
      addServer: (data) => {
        const now = new Date().toISOString();
        const server: ServerConnection = {
          ...data,
          id: generateId(),
          pairedAt: now,
          lastConnected: now,
        };
        set((state) => ({
          servers: [...state.servers, server],
          activeServerId: server.id,
          connectionStatus: 'connected',
        }));
      },

      /**
       * Remove a paired server by ID.
       * If the removed server was active, falls back to the first remaining
       * server or null if no servers remain.
       * @param id - Server ID to remove
       */
      removeServer: (id) => {
        set((state) => {
          const remaining = state.servers.filter((s) => s.id !== id);
          const wasActive = state.activeServerId === id;
          return {
            servers: remaining,
            activeServerId: wasActive
              ? remaining.length > 0
                ? remaining[0].id
                : null
              : state.activeServerId,
            connectionStatus: wasActive
              ? remaining.length > 0
                ? 'connecting'
                : 'disconnected'
              : state.connectionStatus,
          };
        });
      },

      /**
       * Switch the active server to a different paired server.
       * Sets connectionStatus to 'connecting' to trigger a reconnect.
       * @param id - Server ID to activate
       */
      switchServer: (id) => {
        set({ activeServerId: id, connectionStatus: 'connecting' });
      },

      /**
       * Rename a paired server by ID.
       * @param id - Server ID to rename
       * @param name - New display name
       */
      renameServer: (id, name) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === id ? { ...s, name } : s
          ),
        }));
      },

      /**
       * Update the connection status of the active server.
       * @param status - New connection status
       */
      setConnectionStatus: (status) => {
        set({ connectionStatus: status });
      },

      /**
       * Update the Bearer token for a specific server.
       * Used when refreshing or rotating tokens.
       * @param serverId - Server to update
       * @param token - New Bearer token
       */
      updateToken: (serverId, token) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId ? { ...s, token } : s
          ),
        }));
      },

      /**
       * Clear the token for a server, effectively logging out.
       * If the server was active, sets connectionStatus to 'disconnected'.
       * @param serverId - Server to logout from
       */
      logout: (serverId) => {
        set((state) => ({
          servers: state.servers.map((s) =>
            s.id === serverId ? { ...s, token: '' } : s
          ),
          connectionStatus:
            state.activeServerId === serverId
              ? 'disconnected'
              : state.connectionStatus,
        }));
      },

      /**
       * Set the hydration completion flag.
       * Called by the persist middleware's onRehydrateStorage callback.
       * @param val - Whether hydration is complete
       */
      setHasHydrated: (val) => {
        set({ _hasHydrated: val });
      },

      /**
       * Store or clear the current device Expo push token.
       * Used by the push hook to track the registered token for
       * unregistration when switching servers.
       * @param token - Expo push token string, or null to clear
       */
      setPushToken: (token) => {
        set({ pushToken: token });
      },
    }),
    {
      name: 'myrlin-servers',
      storage: createSecureStorage(),

      /**
       * Only persist servers and activeServerId to SecureStore.
       * Connection status and hydration flags are transient.
       */
      partialize: (state) => ({
        servers: state.servers,
        activeServerId: state.activeServerId,
      }),

      /**
       * On hydration completion, set the _hasHydrated flag and
       * initialize connectionStatus based on whether an active server exists.
       */
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state._hasHydrated = true;
            // If we have an active server after hydration, mark as connecting
            // so the app can verify the connection on launch
            if (state.activeServerId && state.servers.length > 0) {
              state.connectionStatus = 'connecting';
            }
          }
        };
      },
    }
  )
);
