/**
 * @fileoverview Unit tests for the Card UI primitives.
 *
 * Verifies that Card, CardHeader, CardTitle, CardDescription, CardContent,
 * and CardFooter all render without errors and that CardHeader renders the
 * accent line when `accent={true}`.
 *
 * @module components/ui/card.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './card.js';

describe('Card primitives', () => {
  it('renders Card with children', () => {
    /*
     * Scenario: the Card container must render its children inside a div.
     * Protects: basic rendering of the Card wrapper.
     */
    render(<Card data-testid="card">Content</Card>);
    expect(screen.getByTestId('card')).toBeDefined();
    expect(screen.getByText('Content')).toBeDefined();
  });

  it('renders CardHeader with children', () => {
    /*
     * Scenario: CardHeader must render its children without the accent span
     * by default (accent=false).
     * Protects: CardHeader default rendering without accent.
     */
    render(<CardHeader data-testid="header">Header</CardHeader>);
    expect(screen.getByTestId('header')).toBeDefined();
  });

  it('renders the accent span when CardHeader has accent=true', () => {
    /*
     * Scenario: when accent=true the header must contain an aria-hidden span
     * that displays the brand orange top accent line.
     * Protects: accent prop conditional rendering in CardHeader.
     */
    const { container } = render(
      <CardHeader accent>
        <span>Accented</span>
      </CardHeader>,
    );
    const accentSpan = container.querySelector('[aria-hidden="true"]');
    expect(accentSpan).not.toBeNull();
  });

  it('does not render the accent span when accent=false', () => {
    /*
     * Scenario: without accent prop no extra span should be injected.
     * Protects: accent=false (default) produces no accent element.
     */
    const { container } = render(
      <CardHeader>
        <span>No accent</span>
      </CardHeader>,
    );
    const accentSpan = container.querySelector('[aria-hidden="true"]');
    expect(accentSpan).toBeNull();
  });

  it('renders CardTitle', () => {
    /*
     * Scenario: CardTitle must render its text content.
     * Protects: basic rendering of CardTitle.
     */
    render(<CardTitle>My Card</CardTitle>);
    expect(screen.getByText('My Card')).toBeDefined();
  });

  it('renders CardDescription', () => {
    /*
     * Scenario: CardDescription must render its text content.
     * Protects: basic rendering of CardDescription.
     */
    render(<CardDescription>Some description</CardDescription>);
    expect(screen.getByText('Some description')).toBeDefined();
  });

  it('renders CardContent', () => {
    /*
     * Scenario: CardContent must render its children.
     * Protects: basic rendering of CardContent.
     */
    render(<CardContent data-testid="content">Body</CardContent>);
    expect(screen.getByTestId('content')).toBeDefined();
  });

  it('renders CardFooter', () => {
    /*
     * Scenario: CardFooter must render its children (typically action buttons).
     * Protects: basic rendering of CardFooter.
     */
    render(<CardFooter data-testid="footer">Footer</CardFooter>);
    expect(screen.getByTestId('footer')).toBeDefined();
  });

  it('merges className on Card', () => {
    /*
     * Scenario: custom className must be merged onto the root div.
     * Protects: cn() className merging in Card.
     */
    render(
      <Card className="my-card" data-testid="card">
        X
      </Card>,
    );
    expect(screen.getByTestId('card').className).toContain('my-card');
  });
});
