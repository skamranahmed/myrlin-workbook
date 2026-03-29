/**
 * SegmentedControl.stories.tsx - Storybook stories for the SegmentedControl.
 *
 * Covers 2-segment and 3-segment layouts with selected state.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { SegmentedControl } from './SegmentedControl';

const meta: Meta<typeof SegmentedControl> = {
  title: 'UI/SegmentedControl',
  component: SegmentedControl,
  argTypes: {
    onSelect: { action: 'selected' },
  },
};

export default meta;
type Story = StoryObj<typeof SegmentedControl>;

/** Two segments with first selected */
export const TwoSegments: Story = {
  args: {
    segments: ['Board', 'List'],
    selectedIndex: 0,
  },
};

/** Three segments with second selected */
export const ThreeSegments: Story = {
  args: {
    segments: ['Day', 'Week', 'Month'],
    selectedIndex: 1,
  },
};

/** Last segment selected */
export const LastSelected: Story = {
  args: {
    segments: ['All', 'Running', 'Stopped'],
    selectedIndex: 2,
  },
};
