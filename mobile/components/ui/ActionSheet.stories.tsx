/**
 * ActionSheet.stories.tsx - Storybook stories for the ActionSheet component.
 *
 * Demonstrates action sheets with normal and destructive action items.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { ActionSheet } from './ActionSheet';

const meta: Meta<typeof ActionSheet> = {
  title: 'UI/ActionSheet',
  component: ActionSheet,
  argTypes: {
    onClose: { action: 'closed' },
  },
};

export default meta;
type Story = StoryObj<typeof ActionSheet>;

/** Action sheet with three normal actions */
export const ThreeActions: Story = {
  args: {
    visible: true,
    actions: [
      { label: 'Rename Session', onPress: () => {} },
      { label: 'Move to Workspace', onPress: () => {} },
      { label: 'Duplicate', onPress: () => {} },
    ],
  },
};

/** Action sheet with a destructive action */
export const WithDestructive: Story = {
  args: {
    visible: true,
    actions: [
      { label: 'Rename Session', onPress: () => {} },
      { label: 'Stop Session', onPress: () => {} },
      { label: 'Delete Session', destructive: true, onPress: () => {} },
    ],
  },
};
