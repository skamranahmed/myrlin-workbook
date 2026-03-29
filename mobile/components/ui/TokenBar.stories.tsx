/**
 * TokenBar.stories.tsx - Storybook stories for the TokenBar component.
 *
 * Covers typical usage, cache-heavy usage, and empty/zero state.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { TokenBar } from './TokenBar';

const meta: Meta<typeof TokenBar> = {
  title: 'UI/TokenBar',
  component: TokenBar,
};

export default meta;
type Story = StoryObj<typeof TokenBar>;

/** Typical token distribution */
export const Default: Story = {
  args: {
    input: 0.4,
    output: 0.3,
    cacheRead: 0.2,
    cacheWrite: 0.1,
  },
};

/** Cache-heavy session (large cache read proportion) */
export const CacheHeavy: Story = {
  args: {
    input: 0.15,
    output: 0.1,
    cacheRead: 0.65,
    cacheWrite: 0.1,
  },
};

/** Empty state (all zero) */
export const Empty: Story = {
  args: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
};
