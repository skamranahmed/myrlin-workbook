/**
 * more/index.tsx - More tab navigation menu with grouped menu items.
 *
 * Replaces the Phase 2 placeholder with a proper menu list linking
 * to all More sub-screens. Grouped into "Sessions" and "Organization"
 * sections. The Conflicts row shows a badge with the live conflict count
 * that polls every 30 seconds.
 *
 * Layout:
 *   1. "More" title header
 *   2. ScrollView with grouped Card rows
 *   3. Each row: icon, label, optional badge, chevron-right
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { useTheme } from '@/hooks/useTheme';
import { useAPIClient } from '@/hooks/useAPIClient';
import { useServerStore } from '@/stores/server-store';
import { fonts } from '@/theme/fonts';
import { Badge } from '@/components/ui';

/** Polling interval for conflict badge count (30 seconds) */
const CONFLICT_POLL_INTERVAL = 30000;

/** Menu item configuration */
interface MenuItem {
  /** Ionicon name for the row icon */
  icon: keyof typeof Ionicons.glyphMap;
  /** Display label */
  label: string;
  /** expo-router path to navigate to */
  route: string;
  /** Optional badge content (e.g. conflict count) */
  badge?: string;
  /** Badge variant for coloring */
  badgeVariant?: 'default' | 'error' | 'warning' | 'success' | 'info';
}

/** Menu section with a title and items */
interface MenuSection {
  /** Section heading */
  title: string;
  /** Items in this section */
  items: MenuItem[];
}

/**
 * MenuRow - A single pressable menu item with icon, label, badge, and chevron.
 *
 * @param props.item - Menu item configuration
 * @param props.onPress - Called when the row is pressed
 */
function MenuRow({
  item,
  onPress,
}: {
  item: MenuItem;
  onPress: () => void;
}) {
  const { theme } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        {
          backgroundColor: pressed
            ? theme.colors.surface1
            : theme.colors.surface0,
          borderColor: theme.colors.borderSubtle,
        },
      ]}
    >
      <Ionicons
        name={item.icon}
        size={20}
        color={theme.colors.accent}
      />
      <Text
        style={[
          styles.menuLabel,
          {
            color: theme.colors.textPrimary,
            fontFamily: fonts.sans.medium,
          },
        ]}
      >
        {item.label}
      </Text>
      {item.badge ? (
        <Badge variant={item.badgeVariant ?? 'default'}>{item.badge}</Badge>
      ) : null}
      <Ionicons
        name="chevron-forward"
        size={18}
        color={theme.colors.textMuted}
      />
    </Pressable>
  );
}

/**
 * MoreScreen - Navigation menu for the More tab.
 *
 * Shows grouped menu items linking to all sub-screens. The Conflicts
 * item includes a live badge count that polls every 30 seconds.
 */
export default function MoreScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const client = useAPIClient();
  const serverCount = useServerStore((s) => s.servers.length);

  // Fetch conflict count for badge
  const conflictsQuery = useQuery({
    queryKey: ['conflicts'],
    queryFn: () => client!.getConflicts(),
    enabled: !!client,
    staleTime: CONFLICT_POLL_INTERVAL,
    refetchInterval: CONFLICT_POLL_INTERVAL,
  });

  const conflictCount = conflictsQuery.data?.conflicts?.length ?? 0;

  // Build menu sections with dynamic conflict badge
  const sections = useMemo<MenuSection[]>(
    () => [
      {
        title: 'Sessions',
        items: [
          {
            icon: 'time-outline',
            label: 'Recent Sessions',
            route: '/more/recent',
          },
          {
            icon: 'list-outline',
            label: 'Session Manager',
            route: '/more/session-manager',
          },
          {
            icon: 'document-outline',
            label: 'Templates',
            route: '/more/templates',
          },
        ],
      },
      {
        title: 'Organization',
        items: [
          {
            icon: 'folder-outline',
            label: 'Workspaces',
            route: '/more/workspaces',
          },
          {
            icon: 'search-outline',
            label: 'Search',
            route: '/more/search',
          },
          {
            icon: 'warning-outline',
            label: 'Conflicts',
            route: '/more/conflicts',
            badge: conflictCount > 0 ? String(conflictCount) : undefined,
            badgeVariant: 'error' as const,
          },
        ],
      },
      {
        title: 'Settings',
        items: [
          {
            icon: 'server-outline',
            label: 'Servers',
            route: '/more/servers',
            badge: serverCount > 0 ? String(serverCount) : undefined,
            badgeVariant: 'info' as const,
          },
          {
            icon: 'settings-outline',
            label: 'Settings',
            route: '/more/settings',
          },
        ],
      },
    ],
    [conflictCount, serverCount]
  );

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: theme.colors.base }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text
          style={[
            styles.title,
            {
              color: theme.colors.textPrimary,
              fontFamily: fonts.sans.semibold,
            },
          ]}
        >
          More
        </Text>
      </View>

      {/* Menu list */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            {/* Section header */}
            <Text
              style={[
                styles.sectionTitle,
                {
                  color: theme.colors.textSecondary,
                  fontFamily: fonts.sans.medium,
                },
              ]}
            >
              {section.title}
            </Text>

            {/* Section items */}
            <View
              style={[
                styles.sectionCard,
                {
                  backgroundColor: theme.colors.surface0,
                  borderColor: theme.colors.borderSubtle,
                },
              ]}
            >
              {section.items.map((item, index) => (
                <React.Fragment key={item.route}>
                  <MenuRow
                    item={item}
                    onPress={() => router.push(item.route as any)}
                  />
                  {index < section.items.length - 1 ? (
                    <View
                      style={[
                        styles.separator,
                        { backgroundColor: theme.colors.borderSubtle },
                      ]}
                    />
                  ) : null}
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  title: {
    fontSize: 28,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingLeft: 4,
  },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuLabel: {
    flex: 1,
    fontSize: 15,
  },
  separator: {
    height: 1,
    marginLeft: 46,
  },
});
