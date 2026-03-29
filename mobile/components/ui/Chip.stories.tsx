/**
 * Chip.stories.tsx - Storybook stories for the Chip component.
 *
 * Covers default, selected, and custom color variations.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Chip } from './Chip';

const meta: Meta<typeof Chip> = {
  title: 'UI/Chip',
  component: Chip,
  argTypes: {
    onPress: { action: 'pressed' },
  },
};

export default meta;
type Story = StoryObj<typeof Chip>;

/** Default unselected chip */
export const Default: Story = {
  args: {
    label: 'All Sessions',
    selected: false,
  },
};

/** Selected chip with accent background */
export const Selected: Story = {
  args: {
    label: 'Running',
    selected: true,
  },
};

/** Chip with custom accent color */
export const CustomColor: Story = {
  args: {
    label: 'Backend',
    selected: true,
    color: '#a6e3a1',
  },
};
