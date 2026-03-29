/**
 * servers.tsx - Server management screen for viewing, renaming, and removing
 * paired Myrlin servers.
 *
 * Features:
 *   - FlatList of all paired servers with name, URL, active badge, tunnel type
 *   - Long-press ActionSheet with switch, rename, and remove actions
 *   - Empty state when no servers are paired
 *   - Relative time-ago for last connected timestamps
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { useServerStore } from '@/stores/server-store';
import { fonts } from '@/theme/fonts';
import { Badge, EmptyState, ActionSheet, ModalSheet, Input, Button } from '@/components/ui';
import type { ActionSheetAction } from '@/components/ui';
import type { ServerConnection } from '@/types/api';

/**
 * Format an ISO timestamp as a relative "time ago" string.
 * Handles seconds, minutes, hours, and days.
 *
 * @param iso - ISO 8601 timestamp
 * @returns Human-readable relative time string
 */
function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/**
 * ServerRow - A single server entry with name, URL, badges, and last connected time.
 *
 * @param props.server - Server connection data
 * @param props.isActive - Whether this server is the currently active one
 * @param props.onLongPress - Callback for long-press to open actions
 */
function ServerRow({
  server,
  isActive,
  onLongPress,
}: {
  server: ServerConnection;
  isActive: boolean;
  onLongPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.serverRow,
        {
          backgroundColor: pressed ? theme.colors.surface1 : theme.colors.surface0,
          borderColor: theme.colors.borderSubtle,
        },
      ]}
    >
      <View style={styles.serverInfo}>
        <View style={styles.serverNameRow}>
          <Text
            style={[
              styles.serverName,
              { color: theme.colors.textPrimary, fontFamily: fonts.sans.semibold },
            ]}
            numberOfLines={1}
          >
            {server.name}
          </Text>
          {isActive ? <Badge variant="success">Active</Badge> : null}
        </View>
        <Text
          style={[
            styles.serverUrl,
            { color: theme.colors.textMuted, fontFamily: fonts.mono.regular },
          ]}
          numberOfLines={1}
        >
          {server.url}
        </Text>
        <View style={styles.serverMeta}>
          <Badge variant="default">{server.tunnelType.toUpperCase()}</Badge>
          <Text
            style={[
              styles.lastConnected,
              { color: theme.colors.textTertiary, fontFamily: fonts.sans.regular },
            ]}
          >
            {timeAgo(server.lastConnected)}
          </Text>
        </View>
      </View>
      <Ionicons name="ellipsis-vertical" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}

/**
 * ServersScreen - Lists all paired servers with management actions.
 *
 * Long-press a server to switch to it, rename it, or remove it.
 * Shows an empty state if no servers are paired.
 */
export default function ServersScreen() {
  const { theme } = useTheme();
  const router = useRouter();

  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const switchServer = useServerStore((s) => s.switchServer);
  const renameServer = useServerStore((s) => s.renameServer);
  const removeServer = useServerStore((s) => s.removeServer);

  // ActionSheet state
  const [actionTarget, setActionTarget] = useState<ServerConnection | null>(null);
  const [showActions, setShowActions] = useState(false);

  // Rename modal state
  const [renameTarget, setRenameTarget] = useState<ServerConnection | null>(null);
  const [renameValue, setRenameValue] = useState('');

  /** Open the action sheet for a server */
  const handleLongPress = useCallback((server: ServerConnection) => {
    setActionTarget(server);
    setShowActions(true);
  }, []);

  /** Build action sheet actions for the selected server */
  const getActions = useCallback((): ActionSheetAction[] => {
    if (!actionTarget) return [];
    const isActive = actionTarget.id === activeServerId;
    const actions: ActionSheetAction[] = [];

    if (!isActive) {
      actions.push({
        label: 'Switch to this server',
        onPress: () => {
          switchServer(actionTarget.id);
          setShowActions(false);
        },
      });
    }

    actions.push({
      label: 'Rename',
      onPress: () => {
        setShowActions(false);
        setRenameTarget(actionTarget);
        setRenameValue(actionTarget.name);
      },
    });

    actions.push({
      label: 'Remove',
      destructive: true,
      onPress: () => {
        setShowActions(false);
        const isLast = servers.length === 1;
        const message = isLast
          ? 'This is your only server. Removing it means you will need to pair again.'
          : `Remove "${actionTarget.name}" from your server list?`;
        Alert.alert('Remove Server', message, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeServer(actionTarget.id),
          },
        ]);
      },
    });

    return actions;
  }, [actionTarget, activeServerId, servers.length, switchServer, removeServer]);

  /** Submit the rename modal */
  const handleRenameSubmit = useCallback(() => {
    if (renameTarget && renameValue.trim()) {
      renameServer(renameTarget.id, renameValue.trim());
      setRenameTarget(null);
    }
  }, [renameTarget, renameValue, renameServer]);

  /** Render a single server row */
  const renderItem = useCallback(
    ({ item }: { item: ServerConnection }) => (
      <ServerRow
        server={item}
        isActive={item.id === activeServerId}
        onLongPress={() => handleLongPress(item)}
      />
    ),
    [activeServerId, handleLongPress]
  );

  /** Unique key for FlatList items */
  const keyExtractor = useCallback((item: ServerConnection) => item.id, []);

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.textPrimary} />
        </Pressable>
        <Text
          style={[
            styles.headerTitle,
            { color: theme.colors.textPrimary, fontFamily: fonts.sans.semibold },
          ]}
        >
          Servers
        </Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Server count */}
      <Text
        style={[
          styles.countLabel,
          { color: theme.colors.textSecondary, fontFamily: fonts.sans.regular },
        ]}
      >
        {servers.length} {servers.length === 1 ? 'server' : 'servers'} connected
      </Text>

      {/* Server list or empty state */}
      {servers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <EmptyState
            icon="server-outline"
            title="No servers connected"
            description="Scan a QR code from the Sessions tab to pair with a Myrlin server."
          />
        </View>
      ) : (
        <FlatList
          data={servers}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Action sheet for server actions */}
      <ActionSheet
        visible={showActions}
        onClose={() => setShowActions(false)}
        actions={getActions()}
      />

      {/* Rename modal */}
      <ModalSheet
        visible={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename Server"
      >
        <View style={styles.renameContent}>
          <Input
            value={renameValue}
            onChangeText={setRenameValue}
            placeholder="Server name"
            autoFocus
            onSubmitEditing={handleRenameSubmit}
          />
          <Button onPress={handleRenameSubmit} variant="primary">
            Save
          </Button>
        </View>
      </ModalSheet>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 17,
  },
  countLabel: {
    fontSize: 13,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 10,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  serverInfo: {
    flex: 1,
    gap: 4,
  },
  serverNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverName: {
    fontSize: 15,
  },
  serverUrl: {
    fontSize: 12,
  },
  serverMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  lastConnected: {
    fontSize: 11,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  renameContent: {
    gap: 16,
    padding: 16,
  },
});
