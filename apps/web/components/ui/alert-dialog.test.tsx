/**
 * @fileoverview Unit tests for the AlertDialog UI primitives.
 *
 * Verifies that AlertDialog, AlertDialogContent, AlertDialogHeader,
 * AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
 * AlertDialogAction, and AlertDialogCancel mount without errors.
 *
 * @module components/ui/alert-dialog.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogTrigger,
} from './alert-dialog.js';

describe('AlertDialog primitives', () => {
  it('renders alert dialog content when open', () => {
    /*
     * Scenario: an open AlertDialog must render its title and description so
     * the user sees the confirmation prompt.
     * Protects: basic rendering of AlertDialog when open={true}.
     */
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    expect(screen.getByText('Are you sure?')).toBeDefined();
    expect(screen.getByText('This cannot be undone.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDefined();
  });

  it('calls onClick handler on AlertDialogAction', () => {
    /*
     * Scenario: clicking the confirm button must invoke the provided onClick
     * so the parent can perform the destructive action.
     * Protects: onClick forwarding in AlertDialogAction.
     */
    const handleConfirm = vi.fn();
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(handleConfirm).toHaveBeenCalledOnce();
  });

  it('renders cancel button as outline variant', () => {
    /*
     * Scenario: AlertDialogCancel must render with outline styling.
     * Protects: AlertDialogCancel uses variant="outline" Button.
     */
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Title</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    expect(cancelBtn.className).toContain('border');
  });

  it('renders nothing visible when closed', () => {
    /*
     * Scenario: a closed AlertDialog must not show its content.
     * Protects: conditional rendering when AlertDialog is not open.
     */
    render(
      <AlertDialog open={false}>
        <AlertDialogTrigger>
          <button type="button">Open</button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Hidden</AlertDialogTitle>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.queryByText('Hidden')).toBeNull();
  });
});
