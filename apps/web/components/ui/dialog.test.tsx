/**
 * @fileoverview Unit tests for the Dialog UI primitives.
 *
 * Verifies that Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle,
 * and DialogDescription all render without errors when the dialog is open.
 *
 * @module components/ui/dialog.test
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from './dialog.js';

describe('Dialog primitives', () => {
  it('renders dialog content when open', () => {
    /*
     * Scenario: an open Dialog must render its content in the DOM so users
     * can interact with the form inside.
     * Protects: basic rendering of Dialog when open={true}.
     */
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test dialog</DialogTitle>
            <DialogDescription>Description text</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button">Close</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText('Test dialog')).toBeDefined();
    expect(screen.getByText('Description text')).toBeDefined();
  });

  it('renders nothing visible when closed', () => {
    /*
     * Scenario: a closed Dialog must not show its children to the user.
     * Protects: conditional rendering of Dialog content when closed.
     */
    render(
      <Dialog open={false}>
        <DialogTrigger>
          <button type="button">Open</button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Hidden dialog</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.queryByText('Hidden dialog')).toBeNull();
  });

  it('mounts without errors with all sub-components', () => {
    /*
     * Scenario: composing all Dialog sub-components must not produce a runtime
     * error or React warning.
     * Protects: full composition path of Dialog primitives.
     */
    expect(() => {
      render(
        <Dialog open>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Title</DialogTitle>
            </DialogHeader>
          </DialogContent>
        </Dialog>,
      );
    }).not.toThrow();
  });
});
