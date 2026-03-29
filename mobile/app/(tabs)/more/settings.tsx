/**
 * settings.tsx - Full settings screen with theme picker, notifications,
 * general toggles, server link, and about section.
 *
 * Sections:
 *   1. Appearance - 13-theme grid picker with live preview
 *   2. Notifications - Segmented control for push notification level
 *   3. General - Haptic feedback and confirm-before-close toggles
 *   4. Servers - Link to server management screen with count badge
 *   5. About - Version display, update check, build number
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';

import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore, type NotificationLevel } from '@/stores/settings-store';
import { useServerStore } from '@/stores/server-store';
import { themes, themeIds } from '@/theme/tokens';
import type { ThemeId } from '@/theme/types';
import { fonts } from '@/theme/fonts';
import { SectionHeader, SegmentedControl, Toggle, Badge, Button } from '@/components/ui';

/** Notification level segments displayed in the SegmentedControl */
const NOTIFICATION_SEGMENTS = ['All', 'Errors Only', 'None'];

/** Maps segment index to notification level value */
const SEGMENT_TO_LEVEL: NotificationLevel[] = ['all', 'errors', 'none'];

/** Number of columns in the theme picker grid */
const THEME_GRID_COLUMNS = 4;

/**
 * ThemeSwatch - A small rounded square showing a theme's accent color.
 *
 * Shows the theme name below and a checkmark overlay when active.
 * Tapping calls setTheme for instant live preview.
 *
 * @param props.id - Theme identifier
 * @param props.isActive - Whether this theme is currently selected
 * @param props.onSelect - Callback when tapped
 */
function ThemeSwatch({
  id,
  isActive,
  onSelect,
}: {
  id: ThemeId;
  isActive: boolean;
  onSelect: (id: ThemeId) => void;
}) {
  const { theme } = useTheme();
  const swatchTheme = themes[id];

  return (
    <Pressable
      onPress={() => onSelect(id)}
      style={[
        styles.swatchContainer,
        { width: `${100 / THEME_GRID_COLUMNS}%` as any },
      ]}
    >
      <View
        style={[
          styles.swatchColor,
          {
            backgroundColor: swatchTheme.colors.accent,
            borderColor: isActive
              ? swatchTheme.colors.accent
              : theme.colors.borderSubtle,
            borderWidth: isActive ? 2.5 : 1,
          },
        ]}
      >
        {isActive ? (
          <Ionicons name="checkmark" size={18} color="#fff" />
        ) : null}
      </View>
      <Text
        style={[
          styles.swatchLabel,
          {
            color: isActive ? theme.colors.textPrimary : theme.colors.textMuted,
            fontFamily: isActive ? fonts.sans.medium : fonts.sans.regular,
          },
        ]}
        numberOfLines={1}
      >
        {swatchTheme.name}
      </Text>
    </Pressable>
  );
}

/**
 * SettingsRow - A generic pressable row with icon, label, right content, and chevron.
 *
 * @param props.icon - Ionicon name
 * @param props.label - Row label text
 * @param props.onPress - Called when tapped (optional, row is non-interactive without it)
 * @param props.rightContent - Content to render on the right side
 * @param props.showChevron - Whether to show a chevron arrow (default false)
 */
function SettingsRow({
  icon,
  label,
  onPress,
  rightContent,
  showChevron = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  rightContent?: React.ReactNode;
  showChevron?: boolean;
}) {
  const { theme } = useTheme();

  const content = (
    <View style={[styles.row, { borderBottomColor: theme.colors.borderSubtle }]}>
      <Ionicons name={icon} size={20} color={theme.colors.accent} />
      <Text
        style={[
          styles.rowLabel,
          { color: theme.colors.textPrimary, fontFamily: fonts.sans.medium },
        ]}
      >
        {label}
      </Text>
      {rightContent}
      {showChevron ? (
        <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? theme.colors.surface1 : 'transparent',
        })}
      >
        {content}
      </Pressable>
    );
  }

  return content;
}

/**
 * SettingsScreen - Main settings screen with all preference sections.
 *
 * Reads and writes settings via useSettingsStore (MMKV-persisted),
 * theme via useTheme context, and server count via useServerStore.
 */
export default function SettingsScreen() {
  const { theme, themeId, setTheme } = useTheme();
  const router = useRouter();

  // Settings store selectors
  const notificationLevel = useSettingsStore((s) => s.notificationLevel);
  const setNotificationLevel = useSettingsStore((s) => s.setNotificationLevel);
  const hapticFeedback = useSettingsStore((s) => s.hapticFeedback);
  const setHapticFeedback = useSettingsStore((s) => s.setHapticFeedback);
  const confirmBeforeClose = useSettingsStore((s) => s.confirmBeforeClose);
  const setConfirmBeforeClose = useSettingsStore((s) => s.setConfirmBeforeClose);

  // Server count for badge
  const serverCount = useServerStore((s) => s.servers.length);

  // Notification segment index derived from store value
  const notificationIndex = SEGMENT_TO_LEVEL.indexOf(notificationLevel);

  /** Handle notification segment change */
  const handleNotificationChange = useCallback(
    (index: number) => {
      setNotificationLevel(SEGMENT_TO_LEVEL[index]);
    },
    [setNotificationLevel]
  );

  /** Handle theme swatch tap */
  const handleThemeSelect = useCallback(
    (id: ThemeId) => {
      setTheme(id);
    },
    [setTheme]
  );

  /** Handle check for updates tap */
  const handleCheckUpdates = useCallback(async () => {
    try {
      // expo-updates is not available in dev builds
      const Updates = require('expo-updates');
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          'Update Available',
          'An update has been downloaded. Restart the app to apply it.',
          [
            { text: 'Later', style: 'cancel' },
            {
              text: 'Restart',
              onPress: () => Updates.reloadAsync(),
            },
          ]
        );
      } else {
        Alert.alert('Up to Date', 'You are running the latest version.');
      }
    } catch {
      Alert.alert('Updates', 'Updates are not available in development builds.');
    }
  }, []);

  // Version strings from expo-application
  const appVersion = Application.nativeApplicationVersion ?? '0.0.0';
  const buildVersion = Application.nativeBuildVersion ?? '1';

  // Memoize row styles for the about section values
  const mutedTextStyle = useMemo<TextStyle>(
    () => ({
      color: theme.colors.textMuted,
      fontFamily: fonts.mono.regular,
      fontSize: theme.typography.sizes.sm,
    }),
    [theme]
  );

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
          Settings
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Appearance */}
        <View style={styles.section}>
          <SectionHeader title="Appearance" />
          <Text
            style={[
              styles.currentThemeLabel,
              { color: theme.colors.textSecondary, fontFamily: fonts.sans.regular },
            ]}
          >
            Current theme: {themes[themeId].name}
          </Text>
          <View style={styles.themeGrid}>
            {themeIds.map((id) => (
              <ThemeSwatch
                key={id}
                id={id}
                isActive={id === themeId}
                onSelect={handleThemeSelect}
              />
            ))}
          </View>
        </View>

        {/* 2. Notifications */}
        <View style={styles.section}>
          <SectionHeader title="Notifications" />
          <SegmentedControl
            segments={NOTIFICATION_SEGMENTS}
            selectedIndex={notificationIndex >= 0 ? notificationIndex : 0}
            onSelect={handleNotificationChange}
          />
          <Text
            style={[
              styles.description,
              { color: theme.colors.textMuted, fontFamily: fonts.sans.regular },
            ]}
          >
            Controls which events trigger push notifications
          </Text>
        </View>

        {/* 3. General */}
        <View style={styles.section}>
          <SectionHeader title="General" />
          <View style={styles.toggleRow}>
            <Toggle
              label="Haptic Feedback"
              description="Vibration on button presses and interactions"
              value={hapticFeedback}
              onValueChange={setHapticFeedback}
            />
          </View>
          <View style={styles.toggleRow}>
            <Toggle
              label="Confirm Before Close"
              description="Show confirmation dialog before stopping sessions"
              value={confirmBeforeClose}
              onValueChange={setConfirmBeforeClose}
            />
          </View>
        </View>

        {/* 4. Servers */}
        <View style={styles.section}>
          <SectionHeader title="Servers" />
          <SettingsRow
            icon="server-outline"
            label="Manage Servers"
            onPress={() => router.push('/more/servers' as any)}
            rightContent={
              serverCount > 0 ? (
                <Badge variant="info">{String(serverCount)}</Badge>
              ) : null
            }
            showChevron
          />
        </View>

        {/* 5. About */}
        <View style={styles.section}>
          <SectionHeader title="About" />
          <SettingsRow
            icon="information-circle-outline"
            label="Version"
            rightContent={<Text style={mutedTextStyle}>{appVersion}</Text>}
          />
          <SettingsRow
            icon="cloud-download-outline"
            label="Check for Updates"
            onPress={handleCheckUpdates}
            showChevron
          />
          <SettingsRow
            icon="construct-outline"
            label="Build"
            rightContent={<Text style={mutedTextStyle}>{buildVersion}</Text>}
          />
        </View>
      </ScrollView>
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
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 17,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 24,
  },
  currentThemeLabel: {
    fontSize: 13,
    marginBottom: 12,
  },
  themeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  swatchContainer: {
    alignItems: 'center',
    marginBottom: 14,
  },
  swatchColor: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  swatchLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 12,
    marginTop: 8,
  },
  toggleRow: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 48,
    paddingHorizontal: 0,
    borderBottomWidth: 1,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
  },
});
