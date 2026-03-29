/**
 * scan-qr.tsx - QR code scanner for server pairing.
 *
 * Uses expo-camera CameraView with barcodeScannerSettings to scan QR codes
 * from the Myrlin desktop web UI. On successful scan, extracts the pairing
 * token, calls the pair endpoint, stores the server, and navigates to tabs.
 *
 * Handles camera permission denial with a fallback to manual connect.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';

import { useTheme } from '@/hooks/useTheme';
import { Button } from '@/components/ui';
import { fonts } from '@/theme/fonts';
import { createAPIClient } from '@/services/api-client';
import { useServerStore } from '@/stores/server-store';

/** QR code payload shape from the Myrlin desktop web UI */
interface QRPayload {
  url: string;
  pairingToken: string;
  serverName: string;
  version: string;
}

const VIEWFINDER_SIZE = 250;

/**
 * ScanQRScreen - Camera-based QR code scanner for server pairing.
 *
 * Flow:
 * 1. Request camera permission
 * 2. Show camera with QR viewfinder overlay
 * 3. On scan, parse QR data and call pair endpoint
 * 4. On success, store server and navigate to tabs
 */
export default function ScanQRScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const addServer = useServerStore((s) => s.addServer);

  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { colors, spacing, typography, radius } = theme;
  const windowWidth = Dimensions.get('window').width;
  const windowHeight = Dimensions.get('window').height;

  /**
   * Get a human-readable device name for the pairing request.
   * Falls back to "Mobile Device" if expo-device info is unavailable.
   */
  function getDeviceName(): string {
    if (Device.deviceName) return Device.deviceName;
    if (Device.modelName) return Device.modelName;
    return 'Mobile Device';
  }

  /**
   * Handle a scanned barcode from the camera.
   * Parses the QR JSON payload, calls the pair endpoint, and stores the result.
   *
   * @param data - Raw string data from the QR code
   */
  async function handleBarCodeScanned({ data }: { data: string }) {
    if (scanned || loading) return;
    setScanned(true);
    setLoading(true);
    setError('');

    try {
      // Parse QR payload
      let payload: QRPayload;
      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error('Invalid QR code. Please scan the code shown in Myrlin desktop.');
      }

      if (!payload.url || !payload.pairingToken) {
        throw new Error('QR code is missing required data. Please try again.');
      }

      // Call pair endpoint (no auth needed)
      const client = createAPIClient(payload.url, '');
      const result = await client.pair(
        payload.pairingToken,
        getDeviceName(),
        Platform.OS
      );

      if (!result.success) {
        throw new Error('Pairing failed. The QR code may have expired.');
      }

      // Store the new server connection
      addServer({
        name: payload.serverName || result.serverName || 'Myrlin Server',
        url: payload.url,
        token: result.token,
        tunnelType: 'lan',
      });

      // Navigate to the main app
      router.replace('/(tabs)/sessions');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Pairing failed. Please try again.';
      setError(message);
      // Allow retry after a brief delay
      setTimeout(() => setScanned(false), 1500);
    } finally {
      setLoading(false);
    }
  }

  // Permission not yet determined
  if (!permission) {
    return (
      <View style={[styles.container, { backgroundColor: colors.base }]} />
    );
  }

  // Permission denied: show fallback UI
  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.base }]}>
        <Pressable
          style={[styles.backButton, { top: spacing.xl + 20 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </Pressable>

        <View style={styles.permissionContent}>
          <Ionicons
            name="camera-outline"
            size={64}
            color={colors.textSecondary}
          />
          <Text
            style={[
              styles.permissionTitle,
              {
                color: colors.textPrimary,
                fontFamily: fonts.sans.bold,
                fontSize: typography.sizes.xl,
              },
            ]}
          >
            Camera Access Needed
          </Text>
          <Text
            style={[
              styles.permissionDesc,
              {
                color: colors.textSecondary,
                fontFamily: fonts.sans.regular,
                fontSize: typography.sizes.md,
              },
            ]}
          >
            Myrlin needs camera access to scan QR codes from your desktop app.
          </Text>
          <View style={[styles.permissionButtons, { gap: spacing.md }]}>
            <Button variant="primary" onPress={requestPermission}>
              Grant Camera Permission
            </Button>
            <Button
              variant="ghost"
              onPress={() => router.replace('/(auth)/manual-connect')}
            >
              Connect Manually Instead
            </Button>
          </View>
        </View>
      </View>
    );
  }

  // Permission granted: show camera
  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{
          barcodeTypes: ['qr'],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Dark overlay with transparent viewfinder cutout */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {/* Top overlay */}
        <View
          style={[
            styles.overlaySection,
            {
              height: (windowHeight - VIEWFINDER_SIZE) / 2 - 40,
              backgroundColor: 'rgba(0,0,0,0.6)',
            },
          ]}
        />
        {/* Middle row: left overlay, viewfinder, right overlay */}
        <View style={styles.middleRow}>
          <View
            style={[
              styles.sideOverlay,
              { backgroundColor: 'rgba(0,0,0,0.6)' },
            ]}
          />
          <View
            style={[
              styles.viewfinder,
              {
                width: VIEWFINDER_SIZE,
                height: VIEWFINDER_SIZE,
                borderRadius: radius.lg,
                borderColor: colors.accent,
              },
            ]}
          />
          <View
            style={[
              styles.sideOverlay,
              { backgroundColor: 'rgba(0,0,0,0.6)' },
            ]}
          />
        </View>
        {/* Bottom overlay */}
        <View
          style={[
            styles.overlaySection,
            {
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.6)',
            },
          ]}
        />
      </View>

      {/* Back button */}
      <Pressable
        style={[styles.backButton, { top: spacing.xl + 20 }]}
        onPress={() => router.back()}
      >
        <Ionicons name="arrow-back" size={24} color="#fff" />
      </Pressable>

      {/* Instructional text */}
      <View
        style={[
          styles.instructionContainer,
          {
            bottom: (windowHeight - VIEWFINDER_SIZE) / 2 - 100,
          },
        ]}
      >
        <Text
          style={[
            styles.instructionText,
            {
              fontFamily: fonts.sans.medium,
              fontSize: typography.sizes.md,
            },
          ]}
        >
          Scan the QR code shown in Myrlin desktop
        </Text>
      </View>

      {/* Error message */}
      {error ? (
        <View
          style={[
            styles.errorContainer,
            {
              backgroundColor: colors.error,
              borderRadius: radius.md,
              padding: spacing.md,
              marginHorizontal: spacing.lg,
            },
          ]}
        >
          <Text
            style={[
              styles.errorText,
              {
                color: '#fff',
                fontFamily: fonts.sans.medium,
                fontSize: typography.sizes.sm,
              },
            ]}
          >
            {error}
          </Text>
        </View>
      ) : null}

      {/* Loading indicator */}
      {loading ? (
        <View style={styles.loadingOverlay}>
          <Text
            style={[
              styles.instructionText,
              {
                fontFamily: fonts.sans.medium,
                fontSize: typography.sizes.lg,
              },
            ]}
          >
            Connecting...
          </Text>
        </View>
      ) : null}
    </View>
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
  permissionContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  permissionTitle: {
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  permissionDesc: {
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permissionButtons: {
    width: '100%',
  },
  overlaySection: {
    width: '100%',
  },
  middleRow: {
    flexDirection: 'row',
    height: VIEWFINDER_SIZE,
  },
  sideOverlay: {
    flex: 1,
  },
  viewfinder: {
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  instructionContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  instructionText: {
    color: '#fff',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  errorContainer: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
  },
  errorText: {
    textAlign: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
