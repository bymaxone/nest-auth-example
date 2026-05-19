/**
 * @fileoverview Unit tests for the `Button` UI primitive.
 *
 * Verifies rendering across all variant and size combinations, the `asChild`
 * prop (Radix Slot), and disabled state behaviour.
 *
 * @module components/ui/button.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button.js';

describe('Button rendering', () => {
  it('renders a button element with the provided label', () => {
    /*
     * Scenario: the default render must produce a <button> element containing
     * the children text.
     * Protects: base rendering of the Button primitive.
     */
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it('renders with variant="destructive" class', () => {
    /*
     * Scenario: the destructive variant must apply the destructive colour
     * classes so the button communicates danger semantics visually.
     * Protects: variant="destructive" class application via cva.
     */
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button', { name: 'Delete' });
    expect(btn.className).toContain('destructive');
  });

  it('renders with variant="ghost" applied', () => {
    /*
     * Scenario: ghost variant buttons are used throughout the app (topbar,
     * revoke buttons). The className must include the hover utility from the
     * ghost variant definition (no background by default).
     * Protects: variant="ghost" class application.
     */
    render(<Button variant="ghost">Ghost</Button>);
    const btn = screen.getByRole('button', { name: 'Ghost' });
    // Ghost variant uses hover:bg-(--glass-bg) — no "ghost" literal in class name.
    expect(btn.className).toContain('hover:bg-(--glass-bg)');
  });

  it('renders with variant="outline" applied', () => {
    /*
     * Scenario: outline variant must apply the border class so the button has
     * a visible border with transparent background.
     * Protects: variant="outline" class application.
     */
    render(<Button variant="outline">Outline</Button>);
    const btn = screen.getByRole('button', { name: 'Outline' });
    expect(btn.className).toContain('border');
  });

  it('renders with variant="secondary" applied', () => {
    /*
     * Scenario: secondary variant must apply the secondary token class.
     * Protects: variant="secondary" class application.
     */
    render(<Button variant="secondary">Secondary</Button>);
    const btn = screen.getByRole('button', { name: 'Secondary' });
    expect(btn.className).toContain('secondary');
  });

  it('renders with variant="link" applied', () => {
    /*
     * Scenario: link variant must apply the underline decoration class.
     * Protects: variant="link" class application.
     */
    render(<Button variant="link">Link</Button>);
    const btn = screen.getByRole('button', { name: 'Link' });
    expect(btn.className).toContain('underline');
  });

  it('renders with size="sm" applied', () => {
    /*
     * Scenario: size="sm" must apply the smaller height/padding classes.
     * Protects: size="sm" class application.
     */
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole('button', { name: 'Small' });
    expect(btn.className).toContain('h-8');
  });

  it('renders with size="lg" applied', () => {
    /*
     * Scenario: size="lg" must apply the larger height/padding classes.
     * Protects: size="lg" class application.
     */
    render(<Button size="lg">Large</Button>);
    const btn = screen.getByRole('button', { name: 'Large' });
    expect(btn.className).toContain('h-12');
  });

  it('renders with size="icon" applied', () => {
    /*
     * Scenario: size="icon" must apply a square dimension class.
     * Protects: size="icon" class application.
     */
    render(<Button size="icon" aria-label="icon button" />);
    const btn = screen.getByRole('button', { name: 'icon button' });
    expect(btn.className).toContain('h-10');
  });

  it('renders as disabled when the disabled prop is passed', () => {
    /*
     * Scenario: disabled prop must be forwarded to the native button element.
     * Protects: disabled state prevents user interaction.
     */
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole('button', { name: 'Disabled' });
    expect(btn).toHaveAttribute('disabled');
  });

  it('renders the child element directly when asChild=true', () => {
    /*
     * Scenario: when `asChild=true` the button renders as its child element
     * via Radix Slot (useful for Next.js `<Link>`).
     * Protects: asChild=true delegates rendering to the Slot.
     */
    render(
      <Button asChild>
        <a href="/somewhere">Link button</a>
      </Button>,
    );
    expect(screen.getByRole('link', { name: 'Link button' })).toBeDefined();
  });

  it('merges custom className with variant classes', () => {
    /*
     * Scenario: additional className must be appended via cn() so callers can
     * override specific utilities without replacing all variant classes.
     * Protects: cn() merging of className prop.
     */
    render(<Button className="extra-class">Custom</Button>);
    const btn = screen.getByRole('button', { name: 'Custom' });
    expect(btn.className).toContain('extra-class');
  });
});
