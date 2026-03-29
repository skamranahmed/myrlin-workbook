/**
 * manual-connect.tsx - Manual server connection form.
 *
 * Allows users to connect to a Myrlin server by entering the URL
 * and password manually. Validates the URL, authenticates via the
 * login endpoint, and stores the server connection on success.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@/hooks/useTheme';
import { Button, Input } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import { createAPIClient } from '@/services/api-client';
import { useServerStore } from '@/stores/server-store';

/**
 * Normalize a user-entered URL to a valid HTTP URL.
 * Strips trailing slashes and prepends http:// if no protocol is given.
 *
 * @param raw - Raw URL string from user input
 * @returns Normalized URL string
 */
function normalizeUrl(raw: string): string {
  let url = raw.trim();
  // Strip trailing slashes
  url = url.replace(/\/+$/, '');
  // Default to http:// if no protocol
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url;
}

/**
 * Validate that a string is a well-formed URL.
 *
 * @param url - URL string to validate
 * @returns True if the URL is valid
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * ManualConnectScreen - Form for manual server URL + password entry.
 *
 * Fields: Server URL, Password, Server Name (optional).
 * Validates URL format, calls login endpoint, stores connection on success.
 */
export default function ManualConnectScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const addServer = useServerStore((s) => s.addServer);

  const [serverUrl, setServerUrl] = useState('');
  const [password, setPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [urlError, setUrlError] = useState('');

  const { colors, spacing, typography, radius } = theme;

  /**
   * Validate the URL field on blur.
   * Shows inline error if the URL is malformed.
   */
  function validateUrl() {
    if (!serverUrl.trim()) {
      setUrlError('');
      return;
    }
    const normalized = normalizeUrl(serverUrl);
    if (!isValidUrl(normalized)) {
      setUrlError('Enter a valid URL (e.g. http://192.168.1.50:3456)');
    } else {
      setUrlError('');
    }
  }

  /**
   * Handle form submission.
   * Normalizes the URL, validates inputs, calls login, and stores the server.
   */
  async function handleConnect() {
    setError('');
    setUrlError('');

    const url = normalizeUrl(serverUrl);

    if (!serverUrl.trim()) {
      setUrlError('Server URL is required');
      return;
    }
    if (!isValidUrl(url)) {
      setUrlError('Enter a valid URL (e.g. http://192.168.1.50:3456)');
      return;
    }
    if (!password.trim()) {
      setError('Password is required');
      return;
    }

    setLoading(true);

    try {
      const client = createAPIClient(url, '');
      const result = await client.login(password);

      if (result.success) {
        addServer({
          name: serverName.trim() || 'Myrlin Server',
          url,
          token: result.token,
          tunnelType: 'lan',
        });

        // Navigate to main app
        router.replace('/(tabs)/sessions');
      } else {
        setError(result.error || 'Login failed. Check your password.');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not connect to server';
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

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <Text
          style={[
            styles.title,
            {
              color: colors.textPrimary,
              fontFamily: fonts.sans.bold,
              fontSize: typography.sizes.xl,
            },
          ]}
        >
          Connect to Server
        </Text>
        <Text
          style={[
            styles.subtitle,
            {
              color: colors.textSecondary,
              fontFamily: fonts.sans.regular,
              fontSize: typography.sizes.sm,
            },
          ]}
        >
          Enter your Myrlin server URL and password. You can find the password
          in the terminal output when starting the server.
        </Text>

        {/* Form */}
        <View style={[styles.form, { gap: spacing.md }]}>
          <Input
            label="Server URL"
            placeholder="http://192.168.1.50:3456"
            value={serverUrl}
            onChangeText={(text) => {
              setServerUrl(text);
              if (urlError) setUrlError('');
            }}
            onBlur={validateUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            error={urlError || undefined}
          />

          <Input
            label="Password"
            placeholder="Enter server password"
            secureTextEntry
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError('');
            }}
            returnKeyType="next"
          />

          <Input
            label="Server Name (optional)"
            placeholder="My Server"
            value={serverName}
            onChangeText={setServerName}
            returnKeyType="go"
            onSubmitEditing={handleConnect}
          />

          {/* General error */}
          {error ? (
            <Text
              style={[
                styles.errorText,
                {
                  color: colors.error,
                  fontFamily: fonts.sans.regular,
                  fontSize: typography.sizes.sm,
                },
              ]}
            >
              {error}
            </Text>
          ) : null}

          <Button
            variant="primary"
            loading={loading}
            disabled={!serverUrl.trim() || !password.trim()}
            onPress={handleConnect}
          >
            Connect
          </Button>
        </View>
      </ScrollView>
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 40,
  },
  title: {
    marginBottom: 8,
  },
  subtitle: {
    lineHeight: 20,
    marginBottom: 32,
  },
  form: {
    width: '100%',
  },
  errorText: {
    textAlign: 'center',
  },
});
