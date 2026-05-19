/**
 * @fileoverview Unit tests for the `Label` UI primitive.
 *
 * Verifies rendering, htmlFor linking, and className merging.
 *
 * @module components/ui/label.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Label } from './label.js';

describe('Label rendering', () => {
  it('renders the label text', () => {
    /*
     * Scenario: the Label must render its children as text content inside a <label>.
     * Protects: basic rendering of the Label primitive.
     */
    render(<Label>Email address</Label>);
    expect(screen.getByText('Email address')).toBeDefined();
  });

  it('sets htmlFor on the underlying label element', () => {
    /*
     * Scenario: htmlFor must be forwarded to the native <label> so clicking the
     * label focuses the associated input for accessibility.
     * Protects: htmlFor prop forwarding to the Radix Label.
     */
    render(<Label htmlFor="email-input">Email</Label>);
    const label = screen.getByText('Email');
    expect(label.getAttribute('for')).toBe('email-input');
  });

  it('merges custom className with base variant classes', () => {
    /*
     * Scenario: additional className must be appended via cn().
     * Protects: cn() merging in Label.
     */
    render(<Label className="custom-label text-xs">Name</Label>);
    const label = screen.getByText('Name');
    expect(label.className).toContain('custom-label');
  });
});
