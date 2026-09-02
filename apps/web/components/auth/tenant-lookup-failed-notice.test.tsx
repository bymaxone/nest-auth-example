/**
 * @fileoverview Unit tests for `TenantLookupFailedNotice`.
 *
 * Verifies:
 * - The notice says the workspace could not be determined, and names both ways
 *   out — retry, or choose from the picker.
 * - The retry control calls back.
 *
 * @module components/auth/tenant-lookup-failed-notice.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TenantLookupFailedNotice } from './tenant-lookup-failed-notice.js';

describe('TenantLookupFailedNotice', () => {
  it('explains that the workspace is unknown rather than letting a default stand in', () => {
    /*
     * Scenario: the lookup for the link's workspace failed. Falling through to
     * the default workspace with the form live would send real credentials to a
     * tenant the person never chose, so the page says what it does not know.
     * Protects: the copy, including the pointer at the picker as the other way
     * out — a retry that keeps failing would otherwise be a dead end.
     */
    render(<TenantLookupFailedNotice onRetry={vi.fn()} />);

    expect(screen.getByText(/could not tell which workspace/i)).toBeDefined();
    expect(screen.getByText(/pick your workspace above/i)).toBeDefined();
  });

  it('calls onRetry when the retry button is clicked', () => {
    /*
     * Scenario: a transient failure — the usual case. Without this the person
     * has to reload the page to get the link's workspace resolved.
     * Protects: the onClick wiring.
     */
    const onRetry = vi.fn();
    render(<TenantLookupFailedNotice onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
