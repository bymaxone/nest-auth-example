/**
 * @fileoverview Unit tests for the `SessionsTable` component.
 *
 * Verifies:
 * - Loading state is shown while fetching.
 * - Empty state is shown when no sessions are returned.
 * - Table rows render session data when sessions are present.
 * - The revoke button is hidden for the current session.
 * - Clicking revoke calls revokeSession with the correct sessionHash.
 *
 * @module components/dashboard/sessions-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listSessions, revokeSession, handleAuthClientError } from '@/lib/auth-client';
import type { SessionInfo } from '@/lib/auth-client';
import { SessionsTable } from './sessions-table.js';

const NOW = Date.now();

const mockSessions: SessionInfo[] = [
  {
    id: 'sess-1',
    sessionHash: 'hash-1',
    device: 'Chrome on macOS',
    ip: '127.0.0.1',
    isCurrent: true,
    createdAt: NOW - 3600_000,
    lastActivityAt: NOW - 60_000,
  },
  {
    id: 'sess-2',
    sessionHash: 'hash-2',
    device: 'Firefox on Windows',
    ip: '10.0.0.1',
    isCurrent: false,
    createdAt: NOW - 7200_000,
    lastActivityAt: NOW - 120_000,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SessionsTable states', () => {
  it('shows loading text while fetching sessions', () => {
    /*
     * Scenario: before listSessions resolves the component must show a loading
     * indicator so the user knows data is being fetched.
     * Protects: isLoading guard renders loading paragraph.
     */
    vi.mocked(listSessions).mockReturnValue(new Promise(() => undefined));
    render(<SessionsTable />);
    expect(screen.getByText(/loading sessions/i)).toBeDefined();
  });

  it('shows empty state when no sessions are returned', async () => {
    /*
     * Scenario: when the API returns an empty array the component must show
     * a "No active sessions found" message.
     * Protects: empty sessions array renders the empty-state paragraph.
     */
    vi.mocked(listSessions).mockResolvedValue([]);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByText(/no active sessions found/i)).toBeDefined();
    });
  });

  it('renders session rows when sessions are returned', async () => {
    /*
     * Scenario: each session in the list must appear as a table row with the
     * device name visible.
     * Protects: session data is rendered inside TableRow.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByText('Chrome on macOS')).toBeDefined();
      expect(screen.getByText('Firefox on Windows')).toBeDefined();
    });
  });

  it('marks the current session with a "Current" badge', async () => {
    /*
     * Scenario: the current session must show a "Current" badge to distinguish
     * it from other sessions in the list.
     * Protects: isCurrent=true renders the "Current" badge.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByText('Current')).toBeDefined();
    });
  });

  it('does not render a revoke button for the current session', async () => {
    /*
     * Scenario: the current session row must not have a revoke button — the user
     * should use the regular sign-out flow instead.
     * Protects: isCurrent=true hides the Trash2 revoke button.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByText('Current')).toBeDefined();
    });
    // Only one revoke button — for the non-current session.
    const revokeButtons = screen.getAllByRole('button', { name: /revoke session/i });
    expect(revokeButtons).toHaveLength(1);
  });

  it('calls revokeSession with the sessionHash when revoke is clicked', async () => {
    /*
     * Scenario: clicking the revoke button for a non-current session must call
     * revokeSession with the correct sessionHash.
     * Protects: handleRevoke invokes revokeSession with the right identifier.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    vi.mocked(revokeSession).mockResolvedValue(undefined);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /revoke session/i })).toBeDefined();
    });
    fireEvent.click(screen.getByRole('button', { name: /revoke session/i }));
    await waitFor(() => {
      expect(revokeSession).toHaveBeenCalledWith('hash-2');
    });
  });

  it('renders "Unknown device" and "—" fallbacks when device and ip are null', async () => {
    /*
     * Scenario: a session with null device and null ip must render the fallback
     * strings "Unknown device" and "—" so the table cells are never empty.
     * Protects: line 95 — `session.device ?? 'Unknown device'` fallback branch.
     *           line 104 — `session.ip ?? '—'` fallback branch.
     */
    const nullSession = {
      id: 'sess-null',
      sessionHash: 'hash-null',
      device: null as unknown as string,
      ip: null as unknown as string,
      isCurrent: false,
      createdAt: Date.now() - 1000,
      lastActivityAt: Date.now() - 500,
    } satisfies SessionInfo;
    vi.mocked(listSessions).mockResolvedValue([nullSession]);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(screen.getByText('Unknown device')).toBeDefined();
      expect(screen.getByText('—')).toBeDefined();
    });
  });

  it('calls handleAuthClientError when listSessions rejects', async () => {
    /*
     * Scenario: when the initial load fails the error must be forwarded to
     * handleAuthClientError so the user sees a toast.
     * Protects: line 46 — catch block in load() calls handleAuthClientError.
     */
    const err = new Error('Load error');
    vi.mocked(listSessions).mockRejectedValue(err);
    render(<SessionsTable />);
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('calls handleAuthClientError when revokeSession rejects', async () => {
    /*
     * Scenario: when revokeSession throws the error must be forwarded to
     * handleAuthClientError.
     * Protects: line 63 — catch block in handleRevoke calls handleAuthClientError.
     */
    const err = new Error('Revoke error');
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    vi.mocked(revokeSession).mockRejectedValue(err);
    render(<SessionsTable />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke session/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /revoke session/i }));
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});
