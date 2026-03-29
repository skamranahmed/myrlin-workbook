/**
 * Toast.stories.tsx - Storybook stories for the Toast component.
 *
 * Covers all four toast variants: success, error, warning, and info.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Toast } from './Toast';

const meta: Meta<typeof Toast> = {
  title: 'UI/Toast',
  component: Toast,
  argTypes: {
    onDismiss: { action: 'dismissed' },
  },
};

export default meta;
type Story = StoryObj<typeof Toast>;

/** Success toast (green accent) */
export const Success: Story = {
  args: {
    message: 'Session started successfully',
    variant: 'success',
    visible: true,
  },
};

/** Error toast (red accent) */
export const Error: Story = {
  args: {
    message: 'Failed to connect to server',
    variant: 'error',
    visible: true,
  },
};

/** Warning toast (yellow accent) */
export const Warning: Story = {
  args: {
    message: 'Session is idle for over 10 minutes',
    variant: 'warning',
    visible: true,
  },
};

/** Info toast (blue accent) */
export const Info: Story = {
  args: {
    message: 'New version available',
    variant: 'info',
    visible: true,
  },
};
