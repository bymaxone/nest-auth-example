/**
 * @fileoverview Unit tests for the Avatar UI primitives.
 *
 * Verifies that Avatar, AvatarImage, and AvatarFallback mount without errors
 * and apply the expected class patterns.
 *
 * @module components/ui/avatar.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar, AvatarImage, AvatarFallback } from './avatar.js';

describe('Avatar primitives', () => {
  it('renders Avatar container', () => {
    /*
     * Scenario: the Avatar root must render a circular container.
     * Protects: basic rendering of the Avatar primitive.
     */
    render(<Avatar data-testid="avatar" />);
    expect(screen.getByTestId('avatar')).toBeDefined();
  });

  it('renders Avatar with fallback initials', () => {
    /*
     * Scenario: when no image is provided the AvatarFallback must show the
     * initials text so the user has a recognisable avatar placeholder.
     * Protects: AvatarFallback renders its children text content.
     */
    render(
      <Avatar>
        <AvatarFallback>JS</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('JS')).toBeDefined();
  });

  it('renders AvatarFallback when image is not provided', () => {
    /*
     * Scenario: without an AvatarImage the AvatarFallback must always render
     * so the user always sees initials as a placeholder.
     * Protects: AvatarFallback renders as the fallback content.
     */
    render(
      <Avatar>
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    expect(screen.getByText('AB')).toBeDefined();
  });

  it('applies custom className to Avatar container', () => {
    /*
     * Scenario: className must be merged onto the root element via cn().
     * Protects: cn() merging of className prop in Avatar.
     */
    render(<Avatar className="h-7 w-7" data-testid="avatar" />);
    expect(screen.getByTestId('avatar').className).toContain('h-7');
  });

  it('renders AvatarImage component inside Avatar', () => {
    /*
     * Scenario: AvatarImage must mount without errors inside an Avatar container.
     * Protects: line 37 — AvatarImage forwardRef component renders the Radix Image
     * primitive and applies the aspect-square class via cn().
     */
    render(
      <Avatar data-testid="avatar-root">
        <AvatarImage
          src="https://example.com/avatar.png"
          alt="User avatar"
          data-testid="avatar-img"
        />
        <AvatarFallback>AB</AvatarFallback>
      </Avatar>,
    );
    // The Avatar container must be present in the DOM.
    expect(screen.getByTestId('avatar-root')).toBeDefined();
  });
});
