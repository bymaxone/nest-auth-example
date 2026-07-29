/**
 * @fileoverview Unit tests for the Card UI primitives.
 *
 * Verifies that Card, CardHeader, CardTitle, CardDescription, CardContent,
 * and CardFooter all render without errors and that every Card carries the
 * brand top accent line.
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
     * Scenario: CardHeader must render its children.
     * Protects: basic rendering of CardHeader.
     */
    render(<CardHeader data-testid="header">Header</CardHeader>);
    expect(screen.getByTestId('header')).toBeDefined();
  });

  it('draws the brand accent line on every Card', () => {
    /*
     * Scenario: a Card rendered with no header at all.
     * Protects: the accent hairline belonging to the Card rather than to the
     * header, so no card can end up without it — the inconsistency that had
     * some panels accented and others bare.
     */
    const { container } = render(<Card>Bare</Card>);
    const accentSpan = container.querySelector('[aria-hidden="true"]');

    expect(accentSpan).not.toBeNull();
    expect(accentSpan?.className).toContain('via-[rgba(255,98,36,0.4)]');
  });

  it('keeps the accent line ahead of the card content', () => {
    /*
     * Scenario: a Card with children.
     * Protects: the hairline rendering as the first child, so it sits on the
     * top edge rather than after the content in the flow.
     */
    render(
      <Card data-testid="ordered">
        <CardContent>Body</CardContent>
      </Card>,
    );
    const card = screen.getByTestId('ordered');

    expect(card.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves the accent line to the Card, never to the header', () => {
    /*
     * Scenario: a CardHeader rendered on its own.
     * Protects: the header staying free of decoration, so the hairline cannot
     * be drawn twice when a Card wraps a header.
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
