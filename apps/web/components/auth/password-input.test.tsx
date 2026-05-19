/**
 * @fileoverview Unit tests for the `PasswordInput` component.
 *
 * Verifies:
 * - Initial render shows password-type input with "Reveal" toggle.
 * - Clicking the toggle switches the input type to text and updates aria-label to "Conceal".
 * - Clicking the toggle again restores password type.
 * - Forwarded ref attaches correctly.
 *
 * @module components/auth/password-input.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { PasswordInput } from './password-input.js';

describe('PasswordInput rendering', () => {
  it('renders an input with type="password" by default', () => {
    /*
     * Scenario: on initial render the input must be type="password" so the
     * value is hidden. The show/hide toggle is in the "hidden" state.
     * Password inputs do not have role="textbox" — query via querySelector.
     * Protects: default visibility state is secure (password hidden).
     */
    render(<PasswordInput />);
    const inputEl = document.querySelector('input') as HTMLInputElement;
    expect(inputEl.type).toBe('password');
  });

  it('renders the "Reveal" toggle button in unpressed state', () => {
    /*
     * Scenario: the toggle button must exist with aria-label="Reveal"
     * and aria-pressed=false on initial render.
     * Protects: accessible toggle state is correctly initialised.
     */
    render(<PasswordInput />);
    const toggle = screen.getByRole('button', { name: 'Reveal' });
    expect(toggle).toBeDefined();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('passes additional className to the input element', () => {
    /*
     * Scenario: className passed as prop should be forwarded to the inner
     * <Input> so callers can add validation styles.
     * Protects: className prop forwarding to the underlying input.
     */
    render(<PasswordInput className="custom-class" />);
    const inputEl = document.querySelector('input') as HTMLInputElement;
    expect(inputEl.className).toContain('custom-class');
  });
});

describe('PasswordInput toggle behaviour', () => {
  it('switches input type to text when the toggle is clicked', () => {
    /*
     * Scenario: clicking the "Reveal" button must change the input type
     * from "password" to "text" so the value becomes visible.
     * Protects: toggle show/hide switches the input type correctly.
     */
    render(<PasswordInput />);
    const toggle = screen.getByRole('button', { name: 'Reveal' });
    fireEvent.click(toggle);
    const inputEl = document.querySelector('input') as HTMLInputElement;
    expect(inputEl.type).toBe('text');
  });

  it('updates aria-label to "Conceal" after showing', () => {
    /*
     * Scenario: once the password is visible the toggle aria-label must change
     * to "Conceal" so screen-reader users know what the button will do.
     * Protects: aria-label reflects the current visibility state.
     */
    render(<PasswordInput />);
    const toggle = screen.getByRole('button', { name: 'Reveal' });
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Conceal' })).toBeDefined();
  });

  it('updates aria-pressed to true while showing', () => {
    /*
     * Scenario: aria-pressed must be true when the password is visible so
     * assistive technologies announce the pressed/active state.
     * Protects: aria-pressed tracks the visibility toggle correctly.
     */
    render(<PasswordInput />);
    const toggle = screen.getByRole('button', { name: 'Reveal' });
    fireEvent.click(toggle);
    const hideTog = screen.getByRole('button', { name: 'Conceal' });
    expect(hideTog.getAttribute('aria-pressed')).toBe('true');
  });

  it('restores type="password" on second click', () => {
    /*
     * Scenario: clicking the toggle twice must return the input to type="password"
     * proving the toggle is idempotent.
     * Protects: double-toggle restores the secure default state.
     */
    render(<PasswordInput />);
    const toggle = screen.getByRole('button', { name: 'Reveal' });
    fireEvent.click(toggle);
    const hideTog = screen.getByRole('button', { name: 'Conceal' });
    fireEvent.click(hideTog);
    const inputEl = document.querySelector('input') as HTMLInputElement;
    expect(inputEl.type).toBe('password');
  });
});

describe('PasswordInput ref forwarding', () => {
  it('attaches the forwarded ref to the underlying input element', () => {
    /*
     * Scenario: the component uses `forwardRef`; the ref must point to the
     * actual <input> DOM node so React Hook Form can access it.
     * Protects: forwardRef wiring for React Hook Form compatibility.
     */
    const ref = createRef<HTMLInputElement>();
    render(<PasswordInput ref={ref} />);
    expect(ref.current).toBeDefined();
    expect(ref.current?.tagName.toLowerCase()).toBe('input');
  });

  it('is disabled when the disabled prop is passed', () => {
    /*
     * Scenario: disabled prop must be forwarded to the input element so the
     * field cannot be edited when disabled.
     * Protects: prop forwarding to the underlying <Input>.
     */
    render(<PasswordInput disabled />);
    const inputEl = document.querySelector('input') as HTMLInputElement;
    expect(inputEl.disabled).toBe(true);
  });
});
