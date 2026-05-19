/**
 * @fileoverview Unit tests for the Tabs UI primitives.
 *
 * Verifies that Tabs, TabsList, TabsTrigger, and TabsContent mount without
 * errors and that the active tab shows the correct content.
 *
 * @module components/ui/tabs.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './tabs.js';

describe('Tabs primitives', () => {
  it('renders the active tab content', () => {
    /*
     * Scenario: the content panel for the default active tab must be visible
     * in the document immediately after render.
     * Protects: Tabs default rendering shows the correct panel.
     */
    render(
      <Tabs defaultValue="tab1">
        <TabsList>
          <TabsTrigger value="tab1">Tab 1</TabsTrigger>
          <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        </TabsList>
        <TabsContent value="tab1">Content 1</TabsContent>
        <TabsContent value="tab2">Content 2</TabsContent>
      </Tabs>,
    );

    expect(screen.getByText('Content 1')).toBeDefined();
  });

  it('renders all tab triggers', () => {
    /*
     * Scenario: all tab triggers must be present in the document so the user
     * can switch between tabs.
     * Protects: TabsList renders all TabsTrigger children.
     */
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Alpha</TabsTrigger>
          <TabsTrigger value="b">Beta</TabsTrigger>
        </TabsList>
        <TabsContent value="a">A panel</TabsContent>
        <TabsContent value="b">B panel</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole('tab', { name: 'Alpha' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Beta' })).toBeDefined();
  });

  it('merges className on TabsTrigger', () => {
    /*
     * Scenario: custom className must be applied to the tab trigger.
     * Protects: cn() merging in TabsTrigger.
     */
    render(
      <Tabs defaultValue="x">
        <TabsList>
          <TabsTrigger value="x" className="custom-trigger">
            X
          </TabsTrigger>
        </TabsList>
        <TabsContent value="x">X content</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tab', { name: 'X' }).className).toContain('custom-trigger');
  });
});
