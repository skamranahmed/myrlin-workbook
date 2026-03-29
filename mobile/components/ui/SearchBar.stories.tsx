/**
 * SearchBar.stories.tsx - Storybook stories for the SearchBar component.
 *
 * Covers default empty state, with text value, and custom placeholder.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { SearchBar } from './SearchBar';

const meta: Meta<typeof SearchBar> = {
  title: 'UI/SearchBar',
  component: SearchBar,
  argTypes: {
    onChangeText: { action: 'text changed' },
    onSubmit: { action: 'submitted' },
  },
};

export default meta;
type Story = StoryObj<typeof SearchBar>;

/** Default empty search bar */
export const Default: Story = {
  args: {
    value: '',
    placeholder: 'Search sessions...',
  },
};

/** Search bar with a value entered */
export const WithValue: Story = {
  args: {
    value: 'authentication',
    placeholder: 'Search sessions...',
  },
};

/** Search bar with custom placeholder */
export const CustomPlaceholder: Story = {
  args: {
    value: '',
    placeholder: 'Find conversations...',
  },
};
