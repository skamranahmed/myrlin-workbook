/**
 * main.ts - Storybook React Native configuration.
 *
 * Discovers all *.stories.tsx files under the components directory.
 * Configures on-device addons for interactive controls and actions.
 */

import type { StorybookConfig } from '@storybook/react-native';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.tsx'],
  addons: [
    '@storybook/addon-ondevice-controls',
    '@storybook/addon-ondevice-actions',
  ],
};

export default config;
