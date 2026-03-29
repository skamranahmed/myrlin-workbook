/**
 * BiometricGate.tsx - Full-screen lock overlay with biometric authentication.
 *
 * Renders an opaque overlay covering the entire app when biometric lock is active.
 * Automatically prompts for Face ID or fingerprint on mount. If the auto-prompt
 * fails or is dismissed, shows a "Tap to unlock" button for manual retry.
 *
 * Uses Reanimated for a smooth fade-in entrance animation.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';

import { useTheme } from '@/hooks/useTheme';
import { useAuthStore } from '@/stores/auth-store';
import { fonts } from '@/theme/fonts';

/**
 * BiometricGate - Lock screen overlay that blocks app access until authenticated.
 *
 * Behavior:
 * 1. On mount, fades in with a 200ms animation
 * 2. Immediately triggers biometric prompt (Face ID, fingerprint, or passcode)
 * 3. On success, calls unlock() to dismiss the gate
 * 4. On failure/cancel, shows a "Tap to unlock" button for retry
 *
 * Must be rendered conditionally: `{biometricEnabled && isLocked && <BiometricGate />}`
 */
export function BiometricGate() {
  const { theme } = useTheme();
  const unlock = useAuthStore((s) => s.unlock);
  const [showRetry, setShowRetry] = useState(false);

  // Fade-in animation
  const opacity = useSharedValue(0);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  /**
   * Attempt biometric authentication.
   * On success, unlocks the app. On failure, reveals the retry button.
   */
  const authenticate = useCallback(async () => {
    setShowRetry(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Myrlin',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });

      if (result.success) {
        unlock();
      } else {
        setShowRetry(true);
      }
    } catch {
      setShowRetry(true);
    }
  }, [unlock]);

  // Fade in and auto-prompt on mount
  useEffect(() => {
    opacity.value = withTiming(1, { duration: 200 });
    authenticate();
  }, [opacity, authenticate]);

  const styles = getStyles(theme);

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={48}
            color={theme.colors.accent}
          />
        </View>

        <Text style={styles.title}>Myrlin is locked</Text>
        <Text style={styles.subtitle}>
          Authenticate to continue
        </Text>

        {showRetry && (
          <Pressable
            onPress={authenticate}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && styles.retryButtonPressed,
            ]}
          >
            <Ionicons
              name="finger-print-outline"
              size={20}
              color={theme.colors.base}
            />
            <Text style={styles.retryButtonText}>Tap to unlock</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

/**
 * Generate styles using the current theme.
 * @param theme - Active MyrlinTheme
 * @returns StyleSheet for BiometricGate
 */
function getStyles(theme: ReturnType<typeof useTheme>['theme']) {
  return StyleSheet.create({
    container: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 9999,
      backgroundColor: theme.colors.base,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      alignItems: 'center',
      paddingHorizontal: theme.spacing.xl,
    },
    iconContainer: {
      width: 80,
      height: 80,
      borderRadius: theme.radius.full,
      backgroundColor: theme.colors.surface0,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: theme.spacing.lg,
    },
    title: {
      fontFamily: fonts.sans.semibold,
      fontSize: theme.typography.sizes.xl,
      color: theme.colors.text,
      marginBottom: theme.spacing.xs,
    },
    subtitle: {
      fontFamily: fonts.sans.regular,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.subtext0,
      marginBottom: theme.spacing.xl,
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      backgroundColor: theme.colors.accent,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
      borderRadius: theme.radius.lg,
    },
    retryButtonPressed: {
      opacity: 0.8,
    },
    retryButtonText: {
      fontFamily: fonts.sans.semibold,
      fontSize: theme.typography.sizes.md,
      color: theme.colors.base,
    },
  });
}
