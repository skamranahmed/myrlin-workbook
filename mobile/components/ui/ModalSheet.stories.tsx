/**
 * ModalSheet.stories.tsx - Storybook stories for the ModalSheet component.
 *
 * Demonstrates the bottom sheet modal with title and children content.
 * Note: Stories render the modal as visible for demonstration purposes.
 */

import React from 'react';
import { Text } from 'react-native';
import type { Meta, StoryObj } from '@storybook/react-native';

import { ModalSheet } from './ModalSheet';

const meta: Meta<typeof ModalSheet> = {
  title: 'UI/ModalSheet',
  component: ModalSheet,
  argTypes: {
    onClose: { action: 'closed' },
  },
};

export default meta;
type Story = StoryObj<typeof ModalSheet>;

/** Default modal sheet with title and text content */
export const Default: Story = {
  args: {
    visible: true,
    title: 'Session Options',
    children: (
      <Text style={{ color: '#cdd6f4', fontSize: 14 }}>
        Modal content goes here. This sheet slides up from the bottom.
      </Text>
    ),
  },
};

/** Modal sheet without title */
export const NoTitle: Story = {
  args: {
    visible: true,
    children: (
      <Text style={{ color: '#cdd6f4', fontSize: 14 }}>
        A sheet without a title header, just content.
      </Text>
    ),
  },
};
