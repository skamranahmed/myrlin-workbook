/**
 * Toggle.stories.tsx - Storybook stories for the Toggle component.
 *
 * Covers on/off states and description text.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Toggle } from './Toggle';

const meta: Meta<typeof Toggle> = {
  title: 'UI/Toggle',
  component: Toggle,
  argTypes: {
    onValueChange: { action: 'toggled' },
  },
};

export default meta;
type Story = StoryObj<typeof Toggle>;

/** Toggle in the ON state */
export const On: Story = {
  args: {
    value: true,
    label: 'Push Notifications',
  },
};

/** Toggle in the OFF state */
export const Off: Story = {
  args: {
    value: false,
    label: 'Haptic Feedback',
  },
};

/** Toggle with description text */
export const WithDescription: Story = {
  args: {
    value: true,
    label: 'Biometric Lock',
    description: 'Require Face ID or fingerprint to open the app',
  },
};
