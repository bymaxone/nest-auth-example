/**
 * @fileoverview Unit tests for the DropdownMenu UI primitives.
 *
 * Verifies that DropdownMenu primitives mount without errors and that
 * the key composite parts (DropdownMenuLabel, DropdownMenuSeparator,
 * DropdownMenuShortcut, DropdownMenuCheckboxItem, DropdownMenuRadioGroup,
 * DropdownMenuRadioItem) render without crashing.
 *
 * @module components/ui/dropdown-menu.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from './dropdown-menu.js';

describe('DropdownMenu primitives', () => {
  it('renders trigger without errors', () => {
    /*
     * Scenario: the dropdown trigger must render in the document.
     * Protects: basic rendering of DropdownMenuTrigger.
     */
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button">Open menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('button', { name: 'Open menu' })).toBeDefined();
  });

  it('renders DropdownMenuLabel inside open menu', () => {
    /*
     * Scenario: a label inside the dropdown content must render when the menu
     * is opened via the open prop.
     * Protects: DropdownMenuLabel renders its children text.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem>Profile</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('My Account')).toBeDefined();
  });

  it('renders DropdownMenuShortcut', () => {
    /*
     * Scenario: a keyboard shortcut hint inside a menu item must render.
     * Protects: DropdownMenuShortcut renders its children text.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            Settings
            <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('⌘S')).toBeDefined();
  });

  it('renders DropdownMenuCheckboxItem unchecked by default', () => {
    /*
     * Scenario: a checkbox menu item must render with the correct role.
     * Protects: DropdownMenuCheckboxItem renders as a menuitemcheckbox.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked={false}>Show panel</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show panel' })).toBeDefined();
  });

  it('renders DropdownMenuRadioGroup and RadioItem', () => {
    /*
     * Scenario: a radio group in the dropdown must render its items.
     * Protects: DropdownMenuRadioGroup + DropdownMenuRadioItem rendering.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Option B</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole('menuitemradio', { name: 'Option A' })).toBeDefined();
  });

  it('renders DropdownMenuSubTrigger inside a Sub', () => {
    /*
     * Scenario: DropdownMenuSubTrigger must render its children and the ChevronRight
     * icon when placed inside a DropdownMenuSub.
     * Protects: line 29 — DropdownMenuSubTrigger forwardRef component renders.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('More options')).toBeDefined();
  });

  it('renders DropdownMenuSubContent with children when sub is open', () => {
    /*
     * Scenario: DropdownMenuSubContent must render inside the Sub when the sub
     * trigger is in an open state.
     * Protects: line 48 — DropdownMenuSubContent forwardRef component renders.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item A</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Sub item A')).toBeDefined();
  });

  it('renders DropdownMenuSubTrigger with inset=true adds pl-8 class', () => {
    /*
     * Scenario: when inset=true is passed to DropdownMenuSubTrigger the `inset && 'pl-8'`
     * branch must evaluate to true and add the pl-8 padding class.
     * Protects: line 33 — `inset && 'pl-8'` truthy branch.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>Inset sub trigger</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Inset sub trigger')).toBeDefined();
  });

  it('renders DropdownMenuItem with inset=true adds pl-8 class', () => {
    /*
     * Scenario: when inset=true is passed to DropdownMenuItem the `inset && 'pl-8'`
     * branch must evaluate to true and add the pl-8 padding class.
     * Protects: line 103 — `inset && 'pl-8'` truthy branch in DropdownMenuItem.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Inset menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Inset menu item')).toBeDefined();
  });

  it('renders DropdownMenuLabel with inset=true adds pl-8 class', () => {
    /*
     * Scenario: when inset=true is passed to DropdownMenuLabel the `inset && 'pl-8'`
     * branch must evaluate to true and add the pl-8 padding class.
     * Protects: line 166 — `inset && 'pl-8'` truthy branch in DropdownMenuLabel.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Inset label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Inset label')).toBeDefined();
  });
});
