/**
 * EmptyState.stories.tsx - Storybook stories for the EmptyState component.
 *
 * Covers default, with action button, and with custom icon.
 */

import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { EmptyState } from './EmptyState';

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

/** Default empty state with title and description */
export const Default: Story = {
  args: {
    title: 'No Sessions',
    description: 'Start a new Claude session to get going.',
  },
};

/** Empty state with an action button */
export const WithAction: Story = {
  args: {
    title: 'No Workspaces',
    description: 'Create a workspace to organize your sessions.',
    action: {
      label: 'Create Workspace',
      onPress: () => {},
    },
  },
};

/** Empty state with a custom icon element */
export const WithIcon: Story = {
  args: {
    icon: <Text style={{ fontSize: 48 }}>🔍</Text>,
    title: 'No Results',
    description: 'Try a different search query.',
  },
};
