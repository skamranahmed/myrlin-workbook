/**
 * Card.stories.tsx - Storybook stories for the Card component.
 *
 * Covers default, elevated, and pressable card variations.
 */

import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Card } from './Card';

const meta: Meta<typeof Card> = {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    onPress: { action: 'pressed' },
  },
};

export default meta;
type Story = StoryObj<typeof Card>;

/** Default card with children */
export const Default: Story = {
  args: {
    children: <Text style={{ color: '#cdd6f4' }}>Card content goes here</Text>,
  },
};

/** Card with elevated shadow */
export const Elevated: Story = {
  args: {
    elevated: true,
    children: <Text style={{ color: '#cdd6f4' }}>Elevated card with shadow</Text>,
  },
};

/** Pressable card (becomes tappable) */
export const Pressable: Story = {
  args: {
    children: <Text style={{ color: '#cdd6f4' }}>Tap me</Text>,
    onPress: () => {},
  },
};
