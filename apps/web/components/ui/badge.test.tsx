/**
 * @fileoverview Unit tests for the `Badge` UI primitive.
 *
 * Verifies rendering with all variants and custom className merging.
 *
 * @module components/ui/badge.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge.js';

describe('Badge rendering', () => {
  it('renders badge text content', () => {
    /*
     * Scenario: the Badge must render its children as text content.
     * Protects: basic rendering of the Badge component.
     */
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeDefined();
  });

  it('renders with default variant classes', () => {
    /*
     * Scenario: without an explicit variant prop the default orange brand
     * variant classes are applied.
     * Protects: defaultVariants in the cva definition.
     */
    render(<Badge data-testid="badge">Default</Badge>);
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('brand-500');
  });

  it('renders with variant="secondary" applied', () => {
    /*
     * Scenario: secondary variant must apply the secondary background class.
     * Protects: variant="secondary" class application.
     */
    render(
      <Badge variant="secondary" data-testid="badge">
        Secondary
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('secondary');
  });

  it('renders with variant="destructive" applied', () => {
    /*
     * Scenario: destructive variant must apply the destructive background class.
     * Protects: variant="destructive" class application.
     */
    render(
      <Badge variant="destructive" data-testid="badge">
        Error
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('destructive');
  });

  it('renders with variant="outline" applied', () => {
    /*
     * Scenario: outline variant must apply the border class.
     * Protects: variant="outline" class application.
     */
    render(
      <Badge variant="outline" data-testid="badge">
        Outline
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('border');
  });

  it('merges custom className with variant classes', () => {
    /*
     * Scenario: additional className must be appended so callers can add
     * custom utility classes.
     * Protects: cn() merging of className prop.
     */
    render(
      <Badge className="custom-badge" data-testid="badge">
        Custom
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('custom-badge');
  });
});
