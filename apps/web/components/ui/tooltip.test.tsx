/**
 * @fileoverview Unit tests for the Tooltip UI primitives.
 *
 * Verifies that Tooltip, TooltipProvider, TooltipTrigger, and TooltipContent
 * mount without errors.
 *
 * @module components/ui/tooltip.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip.js';

describe('Tooltip primitives', () => {
  it('renders the trigger element', () => {
    /*
     * Scenario: the tooltip trigger button must be present in the document
     * even before the tooltip content is shown.
     * Protects: basic rendering of the Tooltip trigger.
     */
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Hover me</button>
          </TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: 'Hover me' })).toBeDefined();
  });

  it('mounts without errors with default props', () => {
    /*
     * Scenario: a minimal Tooltip setup must render without throwing.
     * Protects: default rendering of the Tooltip composition.
     */
    expect(() => {
      render(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <span>Trigger</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Info</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
    }).not.toThrow();
  });
});
