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

// ── Verbatim toast + Current badge + per-row revoking + time fallbacks ──────

describe('SessionsTable verbatim copy + per-row revoking + time format', () => {
  it('toasts the verbatim "Session revoked." message after a successful revoke', async () => {
    /*
     * Scenario: support docs link to the exact "Session revoked."
     * message. Pin the verbatim string so a regression that truncates
     * or rewrites the toast is caught before it ships.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    vi.mocked(revokeSession).mockResolvedValue(undefined);
    const { toast } = await import('sonner');

    render(<SessionsTable />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /revoke session/i })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole('button', { name: /revoke session/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Session revoked.');
    });
  });

  it('renders the "Current" badge in the SAME row as the current session, not the other row', async () => {
    /*
     * Scenario: the badge must appear on the CURRENT session's row,
     * not on a different row. A mutated `||` would short-circuit on
     * the truthy `<span>` value for non-current rows (rendering the
     * badge on the WRONG row) while the current row would render
     * `true` (no badge) — total count stays at 1 either way, so a
     * count-only assertion misses this defect. Pins the badge's row
     * by reading the surrounding TableCell text and asserting the
     * Chrome (current) row contains "Current" and the Firefox (non-
     * current) row does NOT.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    render(<SessionsTable />);
    await screen.findByText('Chrome on macOS');

    const chromeCell = screen.getByText('Chrome on macOS').closest('div');
    expect(chromeCell?.textContent ?? '').toContain('Current');

    const firefoxCell = screen.getByText('Firefox on Windows').closest('div');
    expect(firefoxCell?.textContent ?? '').not.toContain('Current');
  });

  it('renders both time cells ("Last active" and "Started") with the "ago" suffix', async () => {
    /*
     * Scenario: both time cells render `formatDistanceToNow(date, {
     * addSuffix: true })` — pinning the " ago" suffix defends BOTH the
     * `{ addSuffix: true }` ObjectLiteral options object AND the
     * BooleanLiteral on the `true` value, on BOTH date columns. Uses
     * distinct day-scale offsets so date-fns produces distinguishable
     * strings ("1 day ago", "3 days ago") each containing " ago".
     */
    const dayAgoSessions: SessionInfo[] = [
      {
        ...mockSessions[0]!,
        createdAt: NOW - 86400_000 * 3, // 3 days ago
        lastActivityAt: NOW - 86400_000, // 1 day ago
      },
    ];
    vi.mocked(listSessions).mockResolvedValue(dayAgoSessions);
    render(<SessionsTable />);
    await screen.findByText('Chrome on macOS');
    // The "Started" cell holds 3 days ago, the "Last active" cell holds
    // 1 day ago. Each must render the " ago" suffix — a regression on
    // `{ addSuffix: true }` on EITHER cell would drop one match.
    expect(screen.getByText(/^1 day ago$/)).toBeDefined();
    expect(screen.getByText(/^3 days ago$/)).toBeDefined();
  });

  it("disables ONLY the toggled row's revoke button while the API call is pending", async () => {
    /*
     * Scenario: the per-row `revoking === session.sessionHash` guard
     * must lock only the row whose button was clicked. With a three-
     * session fixture (one current, two revokable) we can click one
     * and assert the OTHER stays clickable. Pins the ConditionalExpression
     * AND the EqualityOperator on the per-row guard.
     */
    const threeSessions: SessionInfo[] = [
      mockSessions[0]!, // current — no button
      mockSessions[1]!, // Firefox — revokable
      {
        ...mockSessions[1]!,
        id: 'sess-3',
        sessionHash: 'hash-3',
        device: 'Safari on iOS',
        isCurrent: false,
      },
    ];
    vi.mocked(listSessions).mockResolvedValue(threeSessions);
    // Never resolve so the in-flight state stays observable.
    vi.mocked(revokeSession).mockReturnValueOnce(new Promise(() => undefined));

    render(<SessionsTable />);
    await screen.findByText('Safari on iOS');

    const revokeButtons = screen.getAllByRole<HTMLButtonElement>('button', {
      name: /revoke session/i,
    });
    expect(revokeButtons).toHaveLength(2);
    fireEvent.click(revokeButtons[0]!);

    await waitFor(() => {
      const disabled = screen
        .getAllByRole<HTMLButtonElement>('button', { name: /revoke session/i })
        .filter((b) => b.disabled);
      expect(disabled).toHaveLength(1);
    });
    const stillEnabled = screen
      .getAllByRole<HTMLButtonElement>('button', { name: /revoke session/i })
      .filter((b) => !b.disabled);
    expect(stillEnabled).toHaveLength(1);
  });

  it('restores the revoke button (no longer disabled) after the API call settles', async () => {
    /*
     * Scenario: pins the `finally { setRevoking(null) }` cleanup — when
     * revokeSession resolves and the table reloads, the per-row
     * disabled state must lift so the user can revoke the next session
     * without a page reload.
     */
    vi.mocked(listSessions).mockResolvedValue(mockSessions);
    vi.mocked(revokeSession).mockResolvedValue(undefined);

    render(<SessionsTable />);
    await screen.findByRole('button', { name: /revoke session/i });
    fireEvent.click(screen.getByRole('button', { name: /revoke session/i }));

    await waitFor(() => {
      expect(revokeSession).toHaveBeenCalled();
    });
    // After the reload, the surviving non-current button must be clickable.
    await waitFor(() => {
      const btn = screen.getByRole<HTMLButtonElement>('button', { name: /revoke session/i });
      expect(btn.disabled).toBe(false);
    });
  });
});
