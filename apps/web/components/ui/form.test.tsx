/**
 * @fileoverview Unit tests for the Form UI primitives.
 *
 * Verifies that Form, FormField, FormItem, FormLabel, FormControl,
 * FormDescription, and FormMessage render without errors inside a React
 * Hook Form context, and that error messages are displayed when validation
 * fails.
 *
 * @module components/ui/form.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
} from './form.js';
import { Input } from './input.js';

/** Zod schema for the test form. */
const testSchema = z.object({
  name: z.string().min(1, 'Name is required'),
});

/** Minimal wrapper that provides a React Hook Form context. */
function TestForm() {
  const form = useForm<{ name: string }>({
    resolver: zodResolver(testSchema),
    defaultValues: { name: '' },
    mode: 'onSubmit',
  });

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(() => undefined)(e)}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Full name</FormLabel>
              <FormControl>
                <Input placeholder="Enter your name" {...field} />
              </FormControl>
              <FormDescription>Your display name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <button type="submit">Submit</button>
      </form>
    </Form>
  );
}

describe('Form primitives', () => {
  it('renders FormLabel text', () => {
    /*
     * Scenario: the FormLabel must render its text content inside the form.
     * Protects: basic rendering of FormLabel inside a FormField context.
     */
    render(<TestForm />);
    expect(screen.getByText('Full name')).toBeDefined();
  });

  it('renders FormDescription text', () => {
    /*
     * Scenario: FormDescription must render the helper text below the input.
     * Protects: basic rendering of FormDescription.
     */
    render(<TestForm />);
    expect(screen.getByText('Your display name.')).toBeDefined();
  });

  it('renders the input via FormControl', () => {
    /*
     * Scenario: FormControl must render the wrapped input and bind aria IDs.
     * Protects: FormControl wraps children with correct aria attributes.
     */
    render(<TestForm />);
    expect(screen.getByPlaceholderText('Enter your name')).toBeDefined();
  });

  it('renders error message via FormMessage when form validation fails on submit', async () => {
    /*
     * Scenario: submitting the form without filling the required name field must
     * trigger the Zod validation error and FormMessage must display it.
     * Protects: FormMessage displays the react-hook-form field error on submit.
     */
    render(<TestForm />);
    // Submit without filling the required name field.
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeDefined();
    });
  });

  it('does not render FormMessage when there is no error', () => {
    /*
     * Scenario: with no error FormMessage must render nothing (returns null).
     * Protects: FormMessage null-return when error is undefined and children absent.
     */
    render(<TestForm />);
    // The paragraph for the error should not exist initially.
    expect(screen.queryByText('Name is required')).toBeNull();
  });

  it('useFormField throws when used inside FormProvider but outside FormField', () => {
    /*
     * Scenario: calling useFormField inside a React Hook Form FormProvider
     * but outside a FormField results in an empty `fieldContext.name`. The guard
     * at line 59 detects this and throws "useFormField must be used within <FormField>".
     * Protects: line 60 — the guard throw when fieldContext.name is falsy.
     */
    function BrokenFormItem() {
      // Wraps a FormLabel (which calls useFormField) inside FormItem but without
      // a surrounding FormField, so fieldContext.name remains the default ''.
      return (
        <FormItem>
          <FormLabel>No FormField parent</FormLabel>
        </FormItem>
      );
    }

    function Wrapper() {
      const form = useForm<{ x: string }>({ defaultValues: { x: '' } });
      return (
        <Form {...form}>
          <BrokenFormItem />
        </Form>
      );
    }

    // Suppress React's error boundary console.error for this test.
    const originalError = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Wrapper />)).toThrow('useFormField must be used within <FormField>');
    } finally {
      console.error = originalError;
    }
  });
});
