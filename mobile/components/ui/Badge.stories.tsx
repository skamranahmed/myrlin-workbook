/**
 * Badge.stories.tsx - Storybook stories for the Badge component.
 *
 * Covers all color variants: default, success, warning, error, and info.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Badge } from './Badge';

const meta: Meta<typeof Badge> = {
  title: 'UI/Badge',
  component: Badge,
};

export default meta;
type Story = StoryObj<typeof Badge>;

/** Default variant with subtle background */
export const Default: Story = {
  args: {
    children: 'Default',
    variant: 'default',
  },
};

/** Success variant (green) */
export const Success: Story = {
  args: {
    children: 'Running',
    variant: 'success',
  },
};

/** Warning variant (yellow) */
export const Warning: Story = {
  args: {
    children: 'Idle',
    variant: 'warning',
  },
};

/** Error variant (red) */
export const Error: Story = {
  args: {
    children: 'Failed',
    variant: 'error',
  },
};

/** Info variant (blue) */
export const Info: Story = {
  args: {
    children: '3 sessions',
    variant: 'info',
  },
};

/** Badge with a numeric count */
export const WithCount: Story = {
  args: {
    children: '42',
    variant: 'info',
  },
};
