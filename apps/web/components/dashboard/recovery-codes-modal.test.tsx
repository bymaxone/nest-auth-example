/**
 * @fileoverview Unit tests for the `RecoveryCodesModal` component.
 *
 * Verifies:
 * - The modal renders recovery codes in a grid when open.
 * - Clicking "I've saved my codes" calls onClose.
 * - The modal renders nothing when open=false.
 *
 * @module components/dashboard/recovery-codes-modal.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RecoveryCodesModal } from './recovery-codes-modal.js';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const CODES = ['AAAA-1111', 'BBBB-2222', 'CCCC-3333', 'DDDD-4444'];

describe('RecoveryCodesModal rendering', () => {
  it('renders recovery codes when open', () => {
    /*
     * Scenario: all recovery codes must be visible in the modal so the user
     * can copy them before dismissing.
     * Protects: codes array is rendered inside the modal grid.
     */
    render(<RecoveryCodesModal open codes={CODES} onClose={vi.fn()} />);
    for (const code of CODES) {
      expect(screen.getByText(code)).toBeDefined();
    }
  });

  it('renders the title and description when open', () => {
    /*
     * Scenario: the modal must show the title and description so the user
     * understands the importance of saving the codes.
     * Protects: AlertDialogTitle and AlertDialogDescription render content.
     */
    render(<RecoveryCodesModal open codes={CODES} onClose={vi.fn()} />);
    expect(screen.getByText(/save your recovery codes/i)).toBeDefined();
    expect(screen.getByText(/each code works only once/i)).toBeDefined();
  });

  it('renders nothing visible when open=false', () => {
    /*
     * Scenario: a closed modal must not show its content.
     * Protects: open=false hides modal content.
     */
    render(<RecoveryCodesModal open={false} codes={CODES} onClose={vi.fn()} />);
    expect(screen.queryByText(/save your recovery codes/i)).toBeNull();
  });
});

describe('RecoveryCodesModal interaction', () => {
  it('calls onClose when the confirm button is clicked', () => {
    /*
     * Scenario: clicking the "I've saved my codes" confirm button must invoke
     * the onClose callback so the parent can proceed with the MFA enable flow.
     * Protects: onClose is called on AlertDialogAction click.
     */
    const onClose = vi.fn();
    render(<RecoveryCodesModal open codes={CODES} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /i've saved my codes/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

// ── Copying ───────────────────────────────────────────────────────────────────

describe('RecoveryCodesModal copying', () => {
  it('copies every code to the clipboard, one per line', async () => {
    /*
     * Scenario: the codes are shown exactly once and transcribing them by hand
     * is how people lose them. The control has to hand over all of them, in a
     * form that pastes into a password manager cleanly.
     * Protects: the copy action carries the full set, newline separated.
     */
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<RecoveryCodesModal open codes={CODES} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy codes/i }));

    await screen.findByRole('button', { name: /copied/i });
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'));
  });

  it('reports a refused clipboard instead of failing silently', async () => {
    /*
     * Scenario: the browser refuses the write — the document is not focused, or
     * permission was denied. The codes stay on screen, so nothing is lost, but
     * the user has to be told the copy did not happen rather than being left to
     * assume it did.
     * Protects: a rejected clipboard write surfaces an error.
     */
    const writeText = vi
      .fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<RecoveryCodesModal open codes={CODES} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /copy codes/i }));

    const { toast } = await import('sonner');
    await vi.waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });
});
