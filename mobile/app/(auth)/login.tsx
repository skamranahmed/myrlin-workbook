/**
 * login.tsx - Password re-entry screen for known servers.
 *
 * Used when a previously paired server's token has expired.
 * Accepts the server ID, URL, and name via route params, prompts
 * for the password, and updates the stored token on success.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { Button, Input } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import { createAPIClient } from '@/services/api-client';
import { useServerStore } from '@/stores/server-store';

/**
 * LoginScreen - Password entry for token-expired servers.
 *
 * Route params:
 * - serverId: ID of the server needing re-auth
 * - serverUrl: Base URL of the server
 * - serverName: Display name of the server
 *
 * On success, updates the token in the store and navigates back.
 */
export default function LoginScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const { serverId, serverUrl, serverName } = useLocalSearchParams<{
    serverId: string;
    serverUrl: string;
    serverName: string;
  }>();

  const updateToken = useServerStore((s) => s.updateToken);
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { colors, spacing, typography, radius } = theme;

  /**
   * Handle login form submission.
   * Calls the server login endpoint, updates the token on success,
   * and navigates back to the previous screen.
   */
  async function handleLogin() {
    if (!password.trim()) {
      setError('Password is required');
      return;
    }
    if (!serverId || !serverUrl) {
      setError('Missing server information');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const client = createAPIClient(serverUrl, '');
      const result = await client.login(password);

      if (result.success) {
        updateToken(serverId, result.token);
        setConnectionStatus('connected');
        router.back();
      } else {
        setError(result.error || 'Login failed');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Connection failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.base }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Back button */}
      <Pressable
        style={[styles.backButton, { top: spacing.xl + 20 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
      </Pressable>

      <View style={styles.content}>
        {/* Server identity */}
        <View style={[styles.serverBadge, { backgroundColor: colors.bgSecondary, borderRadius: radius.lg }]}>
          <Ionicons name="server-outline" size={28} color={colors.accent} />
        </View>
        <Text
          style={[
            styles.serverName,
            {
              color: colors.textPrimary,
              fontFamily: fonts.sans.bold,
              fontSize: typography.sizes.xl,
            },
          ]}
        >
          {serverName || 'Myrlin Server'}
        </Text>
        <Text
          style={[
            styles.description,
            {
              color: colors.textSecondary,
              fontFamily: fonts.sans.regular,
              fontSize: typography.sizes.sm,
            },
          ]}
        >
          Your session has expired. Enter your password to reconnect.
        </Text>

        {/* Password form */}
        <View style={[styles.form, { gap: spacing.md }]}>
          <Input
            label="Password"
            placeholder="Enter server password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            error={error || undefined}
          />

          <Button
            variant="primary"
            loading={loading}
            disabled={!password.trim()}
            onPress={handleLogin}
          >
            Log In
          </Button>
        </View>

        {/* Re-pair option */}
        <Pressable
          style={styles.altAction}
          onPress={() => router.replace('/(auth)/scan-qr')}
        >
          <Text
            style={[
              styles.altActionText,
              {
                color: colors.accent,
                fontFamily: fonts.sans.medium,
                fontSize: typography.sizes.sm,
              },
            ]}
          >
            Scan QR Instead
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 10,
    padding: 8,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  serverBadge: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  serverName: {
    textAlign: 'center',
    marginBottom: 8,
  },
  description: {
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  form: {
    width: '100%',
    marginBottom: 24,
  },
  altAction: {
    padding: 12,
  },
  altActionText: {
    textAlign: 'center',
  },
});
