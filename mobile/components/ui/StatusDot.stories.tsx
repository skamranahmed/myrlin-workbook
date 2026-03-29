/**
 * StatusDot.stories.tsx - Storybook stories for the StatusDot component.
 *
 * Covers all status types and size presets.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { StatusDot } from './StatusDot';

const meta: Meta<typeof StatusDot> = {
  title: 'UI/StatusDot',
  component: StatusDot,
};

export default meta;
type Story = StoryObj<typeof StatusDot>;

/** Running status with pulse animation (green) */
export const Running: Story = {
  args: {
    status: 'running',
    size: 'md',
  },
};

/** Stopped status (grey) */
export const Stopped: Story = {
  args: {
    status: 'stopped',
    size: 'md',
  },
};

/** Error status (red) */
export const Error: Story = {
  args: {
    status: 'error',
    size: 'md',
  },
};

/** Idle status (yellow) */
export const Idle: Story = {
  args: {
    status: 'idle',
    size: 'md',
  },
};

/** Small size dot */
export const SmallDot: Story = {
  args: {
    status: 'running',
    size: 'sm',
  },
};
