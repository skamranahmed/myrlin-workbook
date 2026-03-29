/**
 * ServerMenu.tsx - Server info popover with disconnect and switch actions.
 *
 * Displays a modal overlay showing the active server's details, connection
 * status, a list of other paired servers to switch to, an "Add Server" action,
 * and a destructive "Disconnect" button that logs out from the active server.
 *
 * Triggered by tapping the ConnectionDot in the tab header.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '@/hooks/useTheme';
import { useServerStore } from '@/stores/server-store';
import { createAPIClient } from '@/services/api-client';
import { fonts } from '@/theme/fonts';
import type { ConnectionStatus, ServerConnection } from '@/types/api';
import type { MyrlinTheme } from '@/theme/types';

/** Props for the ServerMenu component */
export interface ServerMenuProps {
  /** Whether the menu is currently visible */
  visible: boolean;
  /** Callback to close the menu */
  onClose: () => void;
}

/** Human-readable status labels */
const STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Offline',
  'token-expired': 'Token Expired',
};

/**
 * Resolve status dot color from the theme.
 * @param status - Connection status
 * @param colors - Theme colors
 * @returns Hex color string
 */
function statusColor(
  status: ConnectionStatus,
  colors: MyrlinTheme['colors']
): string {
  switch (status) {
    case 'connected':
      return colors.green;
    case 'connecting':
      return colors.yellow;
    case 'disconnected':
      return colors.red;
    case 'token-expired':
      return colors.peach;
  }
}

/**
 * ServerMenu - Modal popover for server management.
 *
 * Shows the active server info, allows switching between paired servers,
 * adding new servers, and disconnecting (logging out) from the active server.
 *
 * The disconnect flow:
 * 1. Calls the server's logout endpoint to invalidate the token
 * 2. Removes the server from the local store
 * 3. If no servers remain, navigates to onboarding
 * 4. If other servers remain, the store auto-switches to the first one
 *
 * @param props - visible flag and onClose callback
 */
export function ServerMenu({ visible, onClose }: ServerMenuProps) {
  const { theme } = useTheme();
  const router = useRouter();

  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const getActiveServer = useServerStore((s) => s.getActiveServer);
  const switchServer = useServerStore((s) => s.switchServer);
  const removeServer = useServerStore((s) => s.removeServer);

  const activeServer = getActiveServer();
  const otherServers = servers.filter((s) => s.id !== activeServerId);

  /**
   * Disconnect from the active server.
   * Invalidates the server-side token, removes from local store,
   * and navigates appropriately based on remaining servers.
   */
  const handleDisconnect = useCallback(async () => {
    if (!activeServer) return;

    // Try to invalidate the token server-side (best effort)
    try {
      const client = createAPIClient(activeServer.url, activeServer.token);
      await client.logout();
    } catch {
      // Server may be unreachable; proceed with local cleanup
    }

    const serverId = activeServer.id;
    const remainingCount = servers.length - 1;

    removeServer(serverId);
    onClose();

    if (remainingCount <= 0) {
      // No servers left, go to onboarding
      router.replace('/(auth)/onboarding');
    }
    // If other servers remain, removeServer auto-switches to first remaining
  }, [activeServer, servers, removeServer, onClose, router]);

  /**
   * Switch to a different paired server.
   * @param server - The server to switch to
   */
  const handleSwitch = useCallback(
    (server: ServerConnection) => {
      switchServer(server.id);
      onClose();
    },
    [switchServer, onClose]
  );

  /**
   * Navigate to the onboarding screen to add a new server.
   */
  const handleAddServer = useCallback(() => {
    onClose();
    router.push('/(auth)/onboarding');
  }, [onClose, router]);

  const s = getStyles(theme);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        <View style={s.menuContainer}>
          <Pressable onPress={() => {}}>
            {/* Active server section */}
            <View style={s.section}>
              <Text style={s.sectionTitle}>Active Server</Text>
              {activeServer ? (
                <View style={s.serverRow}>
                  <View style={s.serverInfo}>
                    <Text style={s.serverName} numberOfLines={1}>
                      {activeServer.name}
                    </Text>
                    <Text style={s.serverUrl} numberOfLines={1}>
                      {activeServer.url}
                    </Text>
                  </View>
                  <View style={s.statusRow}>
                    <View
                      style={[
                        s.statusDot,
                        {
                          backgroundColor: statusColor(
                            connectionStatus,
                            theme.colors
                          ),
                        },
                      ]}
                    />
                    <Text style={s.statusLabel}>
                      {STATUS_LABELS[connectionStatus]}
                    </Text>
                  </View>
                </View>
              ) : (
                <Text style={s.emptyText}>No server connected</Text>
              )}
            </View>

            {/* Other servers section */}
            {otherServers.length > 0 && (
              <View style={s.section}>
                <Text style={s.sectionTitle}>Other Servers</Text>
                {otherServers.map((server) => (
                  <Pressable
                    key={server.id}
                    style={({ pressed }) => [
                      s.switchRow,
                      pressed && s.rowPressed,
                    ]}
                    onPress={() => handleSwitch(server)}
                  >
                    <View style={s.serverInfo}>
                      <Text style={s.serverName} numberOfLines={1}>
                        {server.name}
                      </Text>
                      <Text style={s.serverUrl} numberOfLines={1}>
                        {server.url}
                      </Text>
                    </View>
                    <Text style={s.switchLabel}>Switch</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Add server action */}
            <Pressable
              style={({ pressed }) => [
                s.actionRow,
                pressed && s.rowPressed,
              ]}
              onPress={handleAddServer}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={theme.colors.accent}
              />
              <Text style={s.actionLabel}>Add Server</Text>
            </Pressable>

            {/* Separator */}
            <View style={s.separator} />

            {/* Disconnect button */}
            <Pressable
              style={({ pressed }) => [
                s.disconnectRow,
                pressed && s.disconnectPressed,
              ]}
              onPress={handleDisconnect}
            >
              <Ionicons
                name="log-out-outline"
                size={18}
                color={theme.colors.red}
              />
              <Text style={s.disconnectLabel}>Disconnect</Text>
            </Pressable>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Generate themed styles for ServerMenu.
 * @param theme - Active MyrlinTheme
 * @returns StyleSheet
 */
function getStyles(theme: MyrlinTheme) {
  const base: Record<string, ViewStyle | TextStyle> = {
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
      justifyContent: 'flex-start',
      alignItems: 'flex-end',
      paddingTop: 100,
      paddingRight: theme.spacing.md,
    },
    menuContainer: {
      backgroundColor: theme.colors.surface0,
      borderRadius: theme.radius.lg,
      minWidth: 260,
      maxWidth: 320,
      ...theme.shadows.lg,
      overflow: 'hidden',
    },
    section: {
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    sectionTitle: {
      fontFamily: fonts.sans.semibold,
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.subtext0,
      textTransform: 'uppercase' as const,
      letterSpacing: 0.5,
      marginBottom: theme.spacing.xs,
    },
    serverRow: {
      paddingVertical: theme.spacing.xs,
    },
    serverInfo: {
      flex: 1,
    },
    serverName: {
      fontFamily: fonts.sans.semibold,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.text,
    },
    serverUrl: {
      fontFamily: fonts.mono.regular,
      fontSize: theme.typography.sizes.xs,
      color: theme.colors.subtext0,
      marginTop: 2,
    },
    statusRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 6,
      marginTop: theme.spacing.xs,
    },
    statusDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    statusLabel: {
      fontFamily: fonts.sans.medium,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.subtext0,
    },
    emptyText: {
      fontFamily: fonts.sans.regular,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.overlay1,
      fontStyle: 'italic' as const,
    },
    switchRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      paddingVertical: theme.spacing.sm,
    },
    rowPressed: {
      opacity: 0.7,
    },
    switchLabel: {
      fontFamily: fonts.sans.medium,
      fontSize: theme.typography.sizes.sm,
      color: theme.colors.accent,
    },
    actionRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    actionLabel: {
      fontFamily: fonts.sans.medium,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.accent,
    },
    separator: {
      height: 1,
      backgroundColor: theme.colors.overlay0,
      marginHorizontal: theme.spacing.md,
    },
    disconnectRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.md,
    },
    disconnectPressed: {
      backgroundColor: theme.colors.crust,
    },
    disconnectLabel: {
      fontFamily: fonts.sans.semibold,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.red,
    },
  };

  return StyleSheet.create(base as Record<string, ViewStyle>);
}
