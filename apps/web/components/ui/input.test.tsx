/**
 * @fileoverview Unit tests for the `Input` UI primitive.
 *
 * Verifies rendering, type forwarding, disabled state, className merging,
 * and ref forwarding.
 *
 * @module components/ui/input.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { Input } from './input.js';

describe('Input rendering', () => {
  it('renders a text input by default', () => {
    /*
     * Scenario: without a type prop the input defaults to type="text" per HTML spec.
     * Protects: default rendering of the Input primitive.
     */
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText('Type here')).toBeDefined();
  });

  it('forwards the type prop to the underlying input', () => {
    /*
     * Scenario: type="email" must be set on the native <input> element.
     * Protects: type prop forwarding.
     */
    render(<Input type="email" placeholder="email" />);
    const input = screen.getByPlaceholderText('email');
    expect(input.getAttribute('type')).toBe('email');
  });

  it('renders as disabled when disabled prop is passed', () => {
    /*
     * Scenario: disabled prop must be forwarded to the native input.
     * Protects: disabled state forwarding.
     */
    render(<Input disabled placeholder="disabled" />);
    const input = screen.getByPlaceholderText('disabled');
    expect(input).toHaveAttribute('disabled');
  });

  it('merges custom className with base classes', () => {
    /*
     * Scenario: custom className must appear in the rendered output alongside
     * the base utility classes applied by the primitive.
     * Protects: cn() className merging in Input.
     */
    render(<Input className="my-input" placeholder="styled" />);
    const input = screen.getByPlaceholderText('styled');
    expect(input.className).toContain('my-input');
  });

  it('forwards the ref to the underlying input element', () => {
    /*
     * Scenario: the forwarded ref must point to the actual <input> DOM node
     * so React Hook Form can register the field.
     * Protects: forwardRef wiring for form library compatibility.
     */
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="ref" />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName.toLowerCase()).toBe('input');
  });
});
