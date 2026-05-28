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

  it('adds the pl-8 class to DropdownMenuSubTrigger when inset=true (and omits it when inset=false)', () => {
    /*
     * Scenario: the `inset && 'pl-8'` conditional on DropdownMenuSubTrigger
     * adds left padding so sub-triggers visually align with the leading
     * indicator slot on regular items. Both arms are pinned here — the
     * truthy arm by asserting `pl-8` is present, the falsy arm by
     * asserting it's absent when the prop is omitted. This kills the
     * ConditionalExpression mutants on the `&&` (both directions) and
     * the LogicalOperator (`&&` → `||`) without needing a snapshot.
     */
    const { rerender } = render(
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
    expect(screen.getByText('Inset sub trigger').className).toContain('pl-8');

    rerender(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Plain sub trigger</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub item</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Plain sub trigger').className).not.toContain('pl-8');
  });

  it('adds the pl-8 class to DropdownMenuItem when inset=true (and omits it when inset=false)', () => {
    /*
     * Scenario: counterpart to the SubTrigger test for DropdownMenuItem.
     * Same kill strategy — assert pl-8 present with inset, absent
     * without. Pins both arms of the `inset && 'pl-8'` conditional.
     */
    const { rerender } = render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>Inset item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Inset item').className).toContain('pl-8');

    rerender(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Plain item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Plain item').className).not.toContain('pl-8');
  });

  it('adds the pl-8 class to DropdownMenuLabel when inset=true (and omits it when inset=false)', () => {
    /*
     * Scenario: counterpart for DropdownMenuLabel. Same kill strategy.
     */
    const { rerender } = render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Inset label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Inset label').className).toContain('pl-8');

    rerender(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Plain label</DropdownMenuLabel>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText('Plain label').className).not.toContain('pl-8');
  });

  it('renders DropdownMenuCheckboxItem unchecked when the checked prop is omitted (default false)', () => {
    /*
     * Scenario: the `checked = false` default-prop value must drive the
     * underlying Radix CheckboxItem into the unchecked state when no
     * explicit `checked` prop is passed. Pinning the `aria-checked="false"`
     * attribute defends the literal default — a regression that swapped
     * it to `true` would silently render every uncontrolled checkbox in
     * the checked state.
     */
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>
          <button type="button">Menu</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem>Default checkbox</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole('menuitemcheckbox', { name: 'Default checkbox' });
    expect(item.getAttribute('aria-checked')).toBe('false');
  });

  it('renders DropdownMenuShortcut as a span (not a div) so it does not break inline flow', () => {
    /*
     * Scenario: DropdownMenuShortcut is a side decoration inside a menu
     * item — it must be a `<span>` so it composes inside the item's
     * inline flex layout. Pinning `tagName === 'SPAN'` defends against
     * a regression that swapped the element type.
     */
    render(<DropdownMenuShortcut data-testid="shortcut">⌘K</DropdownMenuShortcut>);
    expect(screen.getByTestId('shortcut').tagName).toBe('SPAN');
  });
});
