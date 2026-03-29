/**
 * onboarding.tsx - Welcome screen for first-time users.
 *
 * Displayed when no servers are paired. Offers two paths to connect:
 * 1. Scan a QR code from the Myrlin desktop web UI
 * 2. Manually enter a server URL and password
 *
 * Uses Myrlin branding with Catppuccin-themed colors and Plus Jakarta Sans font.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui';
import { fonts } from '@/theme/fonts';

/**
 * OnboardingScreen - First-launch welcome screen with pairing options.
 *
 * Layout: centered vertically with logo, title, description, and two
 * action buttons. All colors come from the active theme.
 */
export default function OnboardingScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { colors, spacing, typography, radius } = theme;

  return (
    <View style={[styles.container, { backgroundColor: colors.base }]}>
      {/* Logo area */}
      <View
        style={[
          styles.logoContainer,
          {
            backgroundColor: colors.bgSecondary,
            borderRadius: radius.xl,
          },
        ]}
      >
        <Ionicons name="code-working-outline" size={56} color={colors.accent} />
      </View>

      {/* Branding text */}
      <Text
        style={[
          styles.title,
          {
            color: colors.textPrimary,
            fontFamily: fonts.sans.bold,
            fontSize: typography.sizes.xxl,
          },
        ]}
      >
        Welcome to Myrlin
      </Text>
      <Text
        style={[
          styles.subtitle,
          {
            color: colors.textSecondary,
            fontFamily: fonts.sans.regular,
            fontSize: typography.sizes.md,
            paddingHorizontal: spacing.xl,
          },
        ]}
      >
        Monitor and control your Claude Code sessions from your phone.
        Connect to your Myrlin server to get started.
      </Text>

      {/* Action buttons */}
      <View style={[styles.buttonGroup, { gap: spacing.md }]}>
        <Button
          variant="primary"
          icon={
            <Ionicons
              name="qr-code-outline"
              size={20}
              color={colors.crust}
            />
          }
          onPress={() => router.push('/(auth)/scan-qr')}
        >
          Scan QR Code
        </Button>

        <Button
          variant="ghost"
          icon={
            <Ionicons
              name="link-outline"
              size={20}
              color={colors.text}
            />
          }
          onPress={() => router.push('/(auth)/manual-connect')}
        >
          Connect Manually
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 48,
  },
  buttonGroup: {
    width: '100%',
    paddingHorizontal: 16,
  },
});
