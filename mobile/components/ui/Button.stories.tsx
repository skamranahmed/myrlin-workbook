/**
 * Button.stories.tsx - Storybook stories for the Button component.
 *
 * Covers all variant/size combinations, loading state, disabled state,
 * and icon usage.
 */

import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    onPress: { action: 'pressed' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

/** Default primary button */
export const Default: Story = {
  args: {
    children: 'Press Me',
    variant: 'primary',
    size: 'md',
  },
};

/** Primary variant (accent background) */
export const Primary: Story = {
  args: {
    children: 'Primary Action',
    variant: 'primary',
  },
};

/** Danger variant (red background) */
export const Danger: Story = {
  args: {
    children: 'Delete Session',
    variant: 'danger',
  },
};

/** Ghost variant (transparent background with border) */
export const Ghost: Story = {
  args: {
    children: 'Cancel',
    variant: 'ghost',
  },
};

/** Disabled state with reduced opacity */
export const Disabled: Story = {
  args: {
    children: 'Disabled',
    variant: 'primary',
    disabled: true,
  },
};

/** Loading state with activity indicator */
export const Loading: Story = {
  args: {
    children: 'Saving...',
    variant: 'primary',
    loading: true,
  },
};

/** Small size preset */
export const Small: Story = {
  args: {
    children: 'Small',
    variant: 'primary',
    size: 'sm',
  },
};

/** Medium size preset (default) */
export const Medium: Story = {
  args: {
    children: 'Medium',
    variant: 'primary',
    size: 'md',
  },
};
