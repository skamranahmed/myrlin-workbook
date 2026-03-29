/**
 * preview.tsx - Storybook global decorators and configuration.
 *
 * Wraps every story in the ThemeProvider and a SafeAreaView so
 * all components receive correct theme context and safe insets.
 * Uses Mocha as the default theme.
 */

import React from 'react';
import { SafeAreaView, StyleSheet, View } from 'react-native';

import { ThemeProvider } from '../hooks/useTheme';

/**
 * Global decorator that wraps every story with ThemeProvider and SafeAreaView.
 * Provides a full-screen container with the theme base background color.
 *
 * @param Story - The story component to render
 * @returns Wrapped story element
 */
function ThemeDecorator(Story: React.ComponentType) {
  return (
    <ThemeProvider>
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Story />
        </View>
      </SafeAreaView>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 16,
  },
});

export const decorators = [ThemeDecorator];

export const parameters = {
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};
