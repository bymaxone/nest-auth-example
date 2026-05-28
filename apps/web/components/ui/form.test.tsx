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

// ── Stryker-killing strengthenings ───────────────────────────────────────────

describe('Form a11y wiring + error styling', () => {
  it('binds the label htmlFor, input id, and aria-describedby to ids ending in -form-item / -description', () => {
    /*
     * Scenario: screen readers rely on label.htmlFor matching input.id
     * AND on aria-describedby pointing at the description paragraph. The
     * useFormField helper composes these IDs as `${id}-form-item`,
     * `${id}-form-item-description`, `${id}-form-item-message`. Pinning
     * the verbatim suffixes catches a regression that flipped them
     * around (e.g. label pointed at the description id) — a defect
     * accessibility audits would otherwise surface only on real-device
     * runs.
     */
    render(<TestForm />);
    const label = screen.getByText('Full name');
    const input = screen.getByPlaceholderText<HTMLInputElement>('Enter your name');
    const description = screen.getByText('Your display name.');

    const inputId = input.getAttribute('id');
    expect(inputId).toMatch(/-form-item$/);
    expect(label.getAttribute('for')).toBe(inputId);
    expect(description.getAttribute('id')).toMatch(/-form-item-description$/);
    // aria-describedby on the input points at the description id when no
    // error is present.
    expect(input.getAttribute('aria-describedby')).toBe(description.getAttribute('id'));
  });

  it('flips aria-describedby to "<description> <message>" and sets aria-invalid=true when validation fails', async () => {
    /*
     * Scenario: once the user submits an invalid form, the FormMessage
     * renders the error AND the input's aria-describedby must include
     * BOTH ids (description + message) so screen readers announce the
     * error after the description. aria-invalid must also flip to true.
     * Pins the ternary's truthy arm AND the `!!error` cast.
     */
    render(<TestForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    const errorMsg = await screen.findByText('Name is required');
    const input = screen.getByPlaceholderText<HTMLInputElement>('Enter your name');

    expect(input.getAttribute('aria-invalid')).toBe('true');
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy).toContain(errorMsg.getAttribute('id') ?? '__missing__');
    expect(describedBy.split(' ')).toHaveLength(2);
  });

  it('keeps aria-invalid="false" while the form is pristine (no error)', () => {
    /*
     * Scenario: before any submit fires, the input must NOT be marked
     * invalid — pinning the `!!error` cast for the absent-error path.
     * Without this, every input would shout "invalid" to screen readers
     * on first render, breaking the SR experience entirely.
     */
    render(<TestForm />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Enter your name');
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  it('adds the text-destructive class to the FormLabel when validation fails', async () => {
    /*
     * Scenario: when the field is invalid, the label must visually
     * reflect that — Tailwind `text-destructive` is the brand error
     * colour. Pins the `error && 'text-destructive'` conditional's
     * truthy arm AND the literal class string.
     */
    render(<TestForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    await screen.findByText('Name is required');
    const label = screen.getByText('Full name');
    expect(label.className).toContain('text-destructive');
  });

  it('does NOT add the text-destructive class to the FormLabel while pristine', () => {
    /*
     * Scenario: counterpart to the previous test — without error, the
     * label must NOT carry the destructive palette. Defends the falsy
     * arm of `error && 'text-destructive'`.
     */
    render(<TestForm />);
    const label = screen.getByText('Full name');
    expect(label.className).not.toContain('text-destructive');
  });

  it('renders the FormMessage children verbatim when there is no validation error', () => {
    /*
     * Scenario: FormMessage falls back to its children when no field
     * error is present (e.g. a custom hint slot). Pins the
     * `error?.message ? String(error.message) : children` ternary's
     * falsy arm AND the `if (!body) return null` guard for the
     * children-present case.
     */
    function FormWithStaticMessage() {
      const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={() => (
              <FormItem>
                <FormMessage>Static helper text</FormMessage>
              </FormItem>
            )}
          />
        </Form>
      );
    }
    render(<FormWithStaticMessage />);
    expect(screen.getByText('Static helper text')).toBeDefined();
  });

  it('binds the FormMessage paragraph id to the verbatim "-form-item-message" suffix', async () => {
    /*
     * Scenario: aria-describedby on the input lists the message id when
     * an error exists. Pinning the verbatim suffix on the message
     * paragraph defends the `${id}-form-item-message` template — a
     * mutated empty suffix would leave both the message id AND the
     * description id colliding under the same base, breaking screen-
     * reader announcement order.
     */
    render(<TestForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const errorMsg = await screen.findByText('Name is required');
    expect(errorMsg.getAttribute('id')).toMatch(/-form-item-message$/);
  });

  it('gives each FormItem a unique id so multiple fields do not collide', () => {
    /*
     * Scenario: a form with TWO FormFields must render TWO inputs with
     * DISTINCT ids. The `FormItemContext.Provider value={{ id }}` spread
     * uses React.useId() to generate a stable-but-unique id per item —
     * a mutated empty object `value={{}}` would leave both inputs with
     * `undefined-form-item` and screen readers would lose the
     * per-field label association entirely. Pins the ObjectLiteral.
     */
    function TwoFieldForm() {
      const form = useForm<{ first: string; second: string }>({
        defaultValues: { first: '', second: '' },
      });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="first"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First</FormLabel>
                <FormControl>
                  <Input placeholder="first" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="second"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Second</FormLabel>
                <FormControl>
                  <Input placeholder="second" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </Form>
      );
    }
    render(<TwoFieldForm />);
    const firstId = screen.getByPlaceholderText<HTMLInputElement>('first').getAttribute('id');
    const secondId = screen.getByPlaceholderText<HTMLInputElement>('second').getAttribute('id');
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    expect(firstId).not.toBe(secondId);
  });

  it('returns null from FormMessage when neither error nor children are present', () => {
    /*
     * Scenario: the empty FormMessage (no error, no children) must
     * render NOTHING — not an empty `<p>` that adds vertical rhythm
     * to the form. Pins the `if (!body) return null;` guard.
     */
    function FormWithEmptyMessage() {
      const form = useForm<{ name: string }>({ defaultValues: { name: '' } });
      return (
        <Form {...form}>
          <FormField
            control={form.control}
            name="name"
            render={() => (
              <FormItem>
                <span data-testid="anchor">anchor</span>
                <FormMessage />
              </FormItem>
            )}
          />
        </Form>
      );
    }
    const { container } = render(<FormWithEmptyMessage />);
    // The FormItem renders the anchor and nothing else inside it.
    const paragraphs = container.querySelectorAll('p');
    expect(paragraphs).toHaveLength(0);
  });
});
