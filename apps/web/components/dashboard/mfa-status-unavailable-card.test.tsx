/**
 * @fileoverview Unit tests for `MfaStatusUnavailableCard`.
 *
 * Verifies:
 * - The card explains that setup is unavailable rather than rendering a flow
 *   that cannot succeed.
 * - The retry control calls back, which is the only way out of the unknown
 *   state once the page's bounded status attempts are spent.
 *
 * @module components/dashboard/mfa-status-unavailable-card.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { MfaStatusUnavailableCard } from './mfa-status-unavailable-card.js';

describe('MfaStatusUnavailableCard', () => {
  it('explains that setup is unavailable instead of showing a flow that cannot succeed', () => {
    /*
     * Scenario: the status request failed, so whether the account has a
     * password is unknown. Rendering `MfaSetupCard` with a guessed value asks
     * an OAuth-only account for a password it does not have, or hides
     * enrolment from an account that does — this card says so instead.
     * Protects: the copy, which is the whole contribution of this component.
     */
    render(<MfaStatusUnavailableCard onRetry={vi.fn()} />);

    expect(screen.getByText(/two-factor setup is unavailable right now/i)).toBeDefined();
  });

  it('calls onRetry when the retry button is clicked', () => {
    /*
     * Scenario: the page's automatic attempts are bounded, so without this
     * control the user's only way to re-ask is a full page reload.
     * Protects: the onClick wiring — a card that explains the problem but
     * cannot act on it leaves the user exactly as stuck.
     */
    const onRetry = vi.fn();
    render(<MfaStatusUnavailableCard onRetry={onRetry} />);

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledOnce();
  });
});
