/**
 * MetaRow.stories.tsx - Storybook stories for the MetaRow component.
 *
 * Covers default label-value pairs and icon usage.
 */

import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { MetaRow } from './MetaRow';

const meta: Meta<typeof MetaRow> = {
  title: 'UI/MetaRow',
  component: MetaRow,
};

export default meta;
type Story = StoryObj<typeof MetaRow>;

/** Default metadata row */
export const Default: Story = {
  args: {
    label: 'Status',
    value: 'Running',
  },
};

/** Metadata row with an icon */
export const WithIcon: Story = {
  args: {
    label: 'Working Directory',
    value: '/Users/arthur/projects',
    icon: <Text style={{ fontSize: 16 }}>📁</Text>,
  },
};

/** Metadata row showing a cost value */
export const CostValue: Story = {
  args: {
    label: 'Total Cost',
    value: '$4.27',
  },
};
