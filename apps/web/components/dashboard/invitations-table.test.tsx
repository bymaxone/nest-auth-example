/**
 * @fileoverview Unit tests for the `InvitationsTable` component.
 *
 * Verifies loading, empty, and populated states, the revoke flow (success +
 * failure), the verbatim success toast, the `addSuffix: true` suffix on the
 * date cells, the mid-flight disabled state, and the post-revoke button
 * re-enable that protects the `finally { setRevoking(null) }` block.
 *
 * @module components/dashboard/invitations-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  listInvitations: vi.fn(),
  revokeInvitation: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listInvitations, revokeInvitation, handleAuthClientError } from '@/lib/auth-client';
import type { InvitationInfo } from '@/lib/auth-client';
import { toast } from 'sonner';
import { InvitationsTable } from './invitations-table.js';

const ONE_DAY_MS = 86_400_000;
const ONE_HOUR_MS = 3_600_000;

const mockInvitations: InvitationInfo[] = [
  {
    id: 'inv-1',
    email: 'charlie@example.com',
    role: 'MEMBER',
    tenantId: 'tenant-1',
    acceptedAt: null,
    // Fixed offsets (not Date.now()) so the date-fns suffix wording stays deterministic across runs.
    expiresAt: new Date(Date.now() + ONE_DAY_MS).toISOString(),
    createdAt: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
  },
];

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('InvitationsTable states', () => {
  it('shows loading text while fetching invitations', () => {
    /*
     * Scenario: before listInvitations resolves the loading paragraph must be visible.
     * Protects: isLoading guard renders loading state.
     */
    vi.mocked(listInvitations).mockReturnValue(new Promise(() => undefined));
    render(<InvitationsTable refreshKey={0} />);
    expect(screen.getByText(/loading invitations/i)).toBeDefined();
  });

  it('shows empty state when no invitations are returned', async () => {
    /*
     * Scenario: when listInvitations resolves with [] the empty-state message
     * must be displayed.
     * Protects: empty array condition renders the empty-state paragraph.
     */
    vi.mocked(listInvitations).mockResolvedValue([]);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText(/no pending invitations/i)).toBeDefined();
    });
  });

  it('renders invitation rows when invitations are returned', async () => {
    /*
     * Scenario: each invitation must appear in a table row with the invitee email.
     * Protects: invitation data is rendered inside TableRow.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByText('charlie@example.com')).toBeDefined();
    });
  });

  it('renders date cells with the "in"/"ago" suffix from addSuffix: true', async () => {
    /*
     * Scenario: the Expires and Sent columns must render relative wording with
     * the date-fns "in …" / "… ago" suffix, otherwise the human-readable
     * direction of the date is lost.
     * Protects: DATE_FORMAT_OPTIONS { addSuffix: true } passed to
     * formatDistanceToNow — kills the ObjectLiteral `{}` mutant and the
     * BooleanLiteral `false` mutant which would emit "1 day" / "about 1 hour"
     * without the prefix/suffix.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => expect(screen.getByText('charlie@example.com')).toBeDefined());
    const row = screen.getByText('charlie@example.com').closest('tr');
    expect(row).not.toBeNull();
    const rowScope = within(row as HTMLElement);
    // Future expiry → "in …"
    expect(rowScope.getByText(/^in\s.+/i)).toBeDefined();
    // Past createdAt → "… ago"
    expect(rowScope.getByText(/.+\sago$/i)).toBeDefined();
  });
});

describe('InvitationsTable revoke flow', () => {
  it('calls revokeInvitation with the correct id when the revoke button is clicked', async () => {
    /*
     * Scenario: clicking the revoke button must call revokeInvitation with the
     * invitation's id so the backend can invalidate it.
     * Protects: handleRevoke passes the correct id to revokeInvitation.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke invitation/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /revoke invitation/i }));
    await waitFor(() => {
      expect(revokeInvitation).toHaveBeenCalledWith('inv-1');
    });
  });

  it('shows the verbatim "Invitation to <email> revoked." success toast', async () => {
    /*
     * Scenario: a successful revoke must surface the verbatim success toast
     * string with the invitee email interpolated, so support docs and audit
     * dashboards can pattern-match on the exact wording.
     * Protects: StringLiteral mutant on the toast.success template literal —
     * any swap of the message breaks this exact-string assertion.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke invitation/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /revoke invitation/i }));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Invitation to charlie@example.com revoked.');
    });
  });

  it('disables the revoke button while the request is in flight', async () => {
    /*
     * Scenario: between click and resolve the button must be disabled so the
     * operator cannot trigger a duplicate revoke.
     * Protects: disabled={revoking === invite.id} ConditionalExpression — a
     * `false` mutant would leave the button enabled mid-flight.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    let resolveRevoke: () => void = () => undefined;
    vi.mocked(revokeInvitation).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke invitation/i })).toBeDefined(),
    );
    const button = screen.getByRole('button', { name: /revoke invitation/i });
    fireEvent.click(button);
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    resolveRevoke();
  });

  it('re-enables the revoke button after the request settles (finally → setRevoking(null))', async () => {
    /*
     * Scenario: after a successful revoke the row may persist in the next list
     * payload (e.g. eventual consistency); the revoke button for that row must
     * be enabled again so the operator can retry.
     * Protects: finally { setRevoking(null) } in handleRevoke — the empty-block
     * mutant would leave revoking stuck on the just-revoked id, keeping the
     * button disabled forever for that row.
     */
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    vi.mocked(revokeInvitation).mockResolvedValue(undefined);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke invitation/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /revoke invitation/i }));
    await waitFor(() => expect(revokeInvitation).toHaveBeenCalled());
    await waitFor(() => {
      const button = screen.getByRole('button', { name: /revoke invitation/i });
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it('reloads the list when refreshKey changes', async () => {
    /*
     * Scenario: incrementing refreshKey must trigger a new API call so the table
     * reflects the latest invitation state from the parent.
     * Protects: useEffect depends on [load, refreshKey] re-fetches on change.
     */
    vi.mocked(listInvitations).mockResolvedValue([]);
    const { rerender } = render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => expect(listInvitations).toHaveBeenCalledTimes(1));
    rerender(<InvitationsTable refreshKey={1} />);
    await waitFor(() => expect(listInvitations).toHaveBeenCalledTimes(2));
  });

  it('calls handleAuthClientError when listInvitations rejects', async () => {
    /*
     * Scenario: when the initial load fails the error must be forwarded to
     * handleAuthClientError so the user sees a toast.
     * Protects: catch block in load() calls handleAuthClientError.
     */
    const err = new Error('Load error');
    vi.mocked(listInvitations).mockRejectedValue(err);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('calls handleAuthClientError when revokeInvitation rejects', async () => {
    /*
     * Scenario: when revokeInvitation throws the error must be forwarded to
     * handleAuthClientError so the user sees an error toast.
     * Protects: catch block in handleRevoke calls handleAuthClientError.
     */
    const err = new Error('Revoke error');
    vi.mocked(listInvitations).mockResolvedValue(mockInvitations);
    vi.mocked(revokeInvitation).mockRejectedValue(err);
    render(<InvitationsTable refreshKey={0} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke invitation/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /revoke invitation/i }));
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});
