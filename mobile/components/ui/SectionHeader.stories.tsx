/**
 * SectionHeader.stories.tsx - Storybook stories for the SectionHeader component.
 *
 * Covers default title-only and title with action button.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { SectionHeader } from './SectionHeader';

const meta: Meta<typeof SectionHeader> = {
  title: 'UI/SectionHeader',
  component: SectionHeader,
};

export default meta;
type Story = StoryObj<typeof SectionHeader>;

/** Default section header with title */
export const Default: Story = {
  args: {
    title: 'Recent Sessions',
  },
};

/** Section header with a right-aligned action */
export const WithAction: Story = {
  args: {
    title: 'Workspaces',
    action: {
      label: 'See All',
      onPress: () => {},
    },
  },
};
