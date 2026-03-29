/**
 * Skeleton.stories.tsx - Storybook stories for the Skeleton component.
 *
 * Covers default rectangle, circle, and custom dimensions.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Skeleton } from './Skeleton';

const meta: Meta<typeof Skeleton> = {
  title: 'UI/Skeleton',
  component: Skeleton,
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

/** Default rectangle skeleton */
export const Default: Story = {
  args: {
    width: 200,
    height: 20,
  },
};

/** Circle skeleton (avatar placeholder) */
export const Circle: Story = {
  args: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
};

/** Full-width card skeleton */
export const CardPlaceholder: Story = {
  args: {
    width: '100%',
    height: 80,
    borderRadius: 12,
  },
};
