/**
 * Input.stories.tsx - Storybook stories for the Input component.
 *
 * Covers default, with label, placeholder, error state, and disabled.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-native';

import { Input } from './Input';

const meta: Meta<typeof Input> = {
  title: 'UI/Input',
  component: Input,
  argTypes: {
    onChangeText: { action: 'changed' },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

/** Default input with placeholder */
export const Default: Story = {
  args: {
    placeholder: 'Enter workspace name...',
  },
};

/** Input with a label above */
export const WithLabel: Story = {
  args: {
    label: 'Workspace Name',
    placeholder: 'My Workspace',
  },
};

/** Input showing an error message */
export const WithError: Story = {
  args: {
    label: 'Server URL',
    value: 'not-a-url',
    error: 'Please enter a valid URL',
  },
};

/** Disabled input */
export const Disabled: Story = {
  args: {
    label: 'Session ID',
    value: 'abc-123-def',
    editable: false,
  },
};
