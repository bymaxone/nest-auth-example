/**
 * @fileoverview Unit tests for the `InvitationsTable` component.
 *
 * Verifies loading, empty, and populated states, and that the revoke
 * button calls revokeInvitation with the correct ID.
 *
 * @module components/dashboard/invitations-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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
import { InvitationsTable } from './invitations-table.js';

const mockInvitations: InvitationInfo[] = [
  {
    id: 'inv-1',
    email: 'charlie@example.com',
    role: 'MEMBER',
    tenantId: 'tenant-1',
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
];

beforeEach(() => {
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

  it('calls revokeInvitation with correct id when revoke button is clicked', async () => {
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
     * Protects: line 50 — catch block in load() calls handleAuthClientError.
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
     * Protects: line 67 — catch block in handleRevoke calls handleAuthClientError.
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
