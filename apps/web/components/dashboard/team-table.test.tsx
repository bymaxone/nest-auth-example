/**
 * @fileoverview Unit tests for the `TeamTable` component.
 *
 * Verifies loading, empty, and populated states, and that admin users
 * see a status-toggle button except for their own row.
 *
 * @module components/dashboard/team-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  listUsers: vi.fn(),
  updateUserStatus: vi.fn(),
  handleAuthClientError: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listUsers, updateUserStatus, handleAuthClientError } from '@/lib/auth-client';
import type { TenantUserInfo } from '@/lib/auth-client';
import { TeamTable } from './team-table.js';

const mockUsers: TenantUserInfo[] = [
  {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'ADMIN',
    status: 'ACTIVE',
    mfaEnabled: false,
    tenantId: 'tenant-1',
    emailVerified: true,
    lastLoginAt: null,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: 'user-2',
    email: 'bob@example.com',
    name: 'Bob',
    role: 'MEMBER',
    status: 'ACTIVE',
    mfaEnabled: false,
    tenantId: 'tenant-1',
    emailVerified: true,
    lastLoginAt: null,
    createdAt: new Date(Date.now() - 172800_000).toISOString(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TeamTable states', () => {
  it('shows loading text while fetching users', () => {
    /*
     * Scenario: before listUsers resolves the component must show a loading
     * paragraph.
     * Protects: isLoading guard renders loading state.
     */
    vi.mocked(listUsers).mockReturnValue(new Promise(() => undefined));
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    expect(screen.getByText(/loading team/i)).toBeDefined();
  });

  it('shows empty state when no users are returned', async () => {
    /*
     * Scenario: when listUsers resolves with [] the empty state must be shown.
     * Protects: empty array condition renders the empty-state message.
     */
    vi.mocked(listUsers).mockResolvedValue([]);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText(/no members found/i)).toBeDefined();
    });
  });

  it('renders user names and emails in table rows', async () => {
    /*
     * Scenario: each user must appear in a table row with their name and email.
     * Protects: user data is rendered inside TableRow.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('bob@example.com')).toBeDefined();
    });
  });

  it('renders status-toggle buttons for other users when isAdmin=true', async () => {
    /*
     * Scenario: admin view must show suspend/unsuspend buttons for users
     * that are not the current user.
     * Protects: isAdmin=true renders toggle buttons for non-self rows.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => {
      // user-2 is not the current user → must have a suspend button
      const buttons = screen.getAllByRole('button', { name: /suspend/i });
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('does not render a toggle button for the current user', async () => {
    /*
     * Scenario: the admin must not be able to toggle their own status.
     * Protects: user.id === currentUserId guard hides the toggle button.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    // currentUserId is user-2 (Bob) — only Alice gets a button
    render(<TeamTable isAdmin currentUserId="user-2" />);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });
    const buttons = screen.getAllByRole('button', { name: /suspend/i });
    // Only one button — for Alice, not Bob.
    expect(buttons).toHaveLength(1);
  });
});

describe('TeamTable error paths', () => {
  it('calls handleAuthClientError when listUsers rejects', async () => {
    /*
     * Scenario: when the initial load fails the error must be forwarded to
     * handleAuthClientError so the user sees a toast.
     * Protects: line 59 — catch block in load() calls handleAuthClientError.
     */
    const err = new Error('Load error');
    vi.mocked(listUsers).mockRejectedValue(err);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });

  it('calls handleAuthClientError when updateUserStatus rejects', async () => {
    /*
     * Scenario: when updateUserStatus throws the error must be forwarded to
     * handleAuthClientError.
     * Protects: line 77 — catch block in handleToggleStatus calls handleAuthClientError.
     */
    const err = new Error('Toggle error');
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    vi.mocked(updateUserStatus).mockRejectedValue(err);

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    const suspendBtn = screen.getByRole('button', { name: /suspend/i });
    fireEvent.click(suspendBtn);

    await waitFor(() => {
      expect(handleAuthClientError).toHaveBeenCalledWith(
        err,
        expect.objectContaining({ toast: expect.anything() }),
      );
    });
  });
});

describe('TeamTable toggle flow', () => {
  it('calls updateUserStatus and reloads when the toggle button is clicked', async () => {
    /*
     * Scenario: clicking the Suspend button for a user must call updateUserStatus
     * with the next status and reload the table.
     * Protects: handleToggleStatus calls updateUserStatus and re-fetches via load().
     */
    // First load: Alice ACTIVE, Bob ACTIVE. After toggle, Bob is SUSPENDED.
    const bobSuspended: TenantUserInfo = { ...mockUsers[1]!, status: 'SUSPENDED' };
    vi.mocked(listUsers)
      .mockResolvedValueOnce(mockUsers)
      .mockResolvedValueOnce([mockUsers[0]!, bobSuspended]);
    vi.mocked(updateUserStatus).mockResolvedValue({ ...mockUsers[1]!, status: 'SUSPENDED' });

    // Alice is admin (user-1), so Bob's row shows the toggle.
    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // Bob's Suspend button (he's ACTIVE).
    const suspendBtn = screen.getByRole('button', { name: /suspend/i });
    fireEvent.click(suspendBtn);

    await waitFor(() => {
      expect(updateUserStatus).toHaveBeenCalledWith('user-2', 'SUSPENDED');
    });
    // After reload Bob shows as SUSPENDED.
    await waitFor(() => {
      expect(screen.getByText('SUSPENDED')).toBeDefined();
    });
  });

  it('passes ACTIVE as nextStatus and shows "unsuspended" toast when toggling a SUSPENDED user', async () => {
    /*
     * Scenario: clicking the Unsuspend button for a SUSPENDED user must compute
     * nextStatus = 'ACTIVE' (the `? 'SUSPENDED' : 'ACTIVE'` false branch) and
     * call toast.success with "unsuspended".
     * Protects: lines 70-74 — `user.status !== 'ACTIVE'` path and
     *           `nextStatus === 'ACTIVE' ? 'unsuspended'` true branch.
     */
    const suspendedUsers: TenantUserInfo[] = [
      mockUsers[0]!, // Alice – admin, current user
      { ...mockUsers[1]!, status: 'SUSPENDED' }, // Bob – SUSPENDED
    ];
    const { toast } = await import('sonner');
    vi.mocked(listUsers).mockResolvedValue(suspendedUsers);
    vi.mocked(updateUserStatus).mockResolvedValue({ ...mockUsers[1]!, status: 'SUSPENDED' });

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // Bob is SUSPENDED → button label is "Unsuspend".
    const unsuspendBtn = screen.getByRole('button', { name: /unsuspend/i });
    fireEvent.click(unsuspendBtn);

    await waitFor(() => {
      expect(updateUserStatus).toHaveBeenCalledWith('user-2', 'ACTIVE');
      expect(vi.mocked(toast).success).toHaveBeenCalledWith('User unsuspended.');
    });
  });

  it('renders an "Activate" button for a PENDING user and writes ACTIVE on click', async () => {
    /*
     * Scenario: admin sees a teammate sitting in PENDING_APPROVAL. The
     * row must surface an "Activate" button that PATCH-es the status to
     * ACTIVE and shows a "User activated." toast. Pins the new
     * PENDING→ACTIVE branch in the STATUS_ACTIONS matrix — without it
     * the only path out of PENDING would be the API (no UI affordance).
     */
    const pendingUser: TenantUserInfo = { ...mockUsers[1]!, status: 'PENDING' };
    const { toast } = await import('sonner');
    vi.mocked(listUsers).mockResolvedValue([mockUsers[0]!, pendingUser]);
    vi.mocked(updateUserStatus).mockResolvedValue({ ...pendingUser, status: 'ACTIVE' });

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    const activateBtn = screen.getByRole('button', { name: /^activate$/i });
    fireEvent.click(activateBtn);

    await waitFor(() => {
      expect(updateUserStatus).toHaveBeenCalledWith('user-2', 'ACTIVE');
      expect(vi.mocked(toast).success).toHaveBeenCalledWith('User activated.');
    });
  });

  it('renders no action button for a BANNED user (dead-end status)', async () => {
    /*
     * Scenario: BANNED is intentionally a higher-friction state — lifting
     * a ban happens outside the team table (e.g. via a platform admin
     * flow). The table must NOT surface an "Unban" button. Pins the
     * empty-array entry in STATUS_ACTIONS so a future refactor that
     * tries to "be helpful" by re-enabling ban toggles surfaces here.
     */
    const bannedUser: TenantUserInfo = { ...mockUsers[1]!, status: 'BANNED' };
    vi.mocked(listUsers).mockResolvedValue([mockUsers[0]!, bannedUser]);

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // Only Alice's row may contain buttons (she's the current user — no
    // toggle for self). Bob's row must have zero action buttons.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders a "Reactivate" button for an INACTIVE user', async () => {
    /*
     * Scenario: an admin wants to re-enable a deactivated account. The
     * "Reactivate" label distinguishes the action from "Unsuspend" so
     * the audit log + future analytics can see the intent. Pins the
     * INACTIVE→ACTIVE row of the STATUS_ACTIONS matrix.
     */
    const inactiveUser: TenantUserInfo = { ...mockUsers[1]!, status: 'INACTIVE' };
    vi.mocked(listUsers).mockResolvedValue([mockUsers[0]!, inactiveUser]);
    vi.mocked(updateUserStatus).mockResolvedValue({ ...inactiveUser, status: 'ACTIVE' });

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /reactivate/i }));

    await waitFor(() => {
      expect(updateUserStatus).toHaveBeenCalledWith('user-2', 'ACTIVE');
    });
  });

  it('renders no action buttons when the user has an unknown status (admin view)', async () => {
    /*
     * Scenario: a future Prisma enum addition (e.g. ARCHIVED) ships
     * before the team-table is updated. The admin row must render
     * zero buttons rather than crashing — pinning the
     * `STATUS_ACTIONS[status] ?? []` fallback branch.
     */
    const unknownStatusUser: TenantUserInfo = {
      ...mockUsers[1]!,
      status: 'UNKNOWN_STATUS' as TenantUserInfo['status'],
    };
    vi.mocked(listUsers).mockResolvedValue([mockUsers[0]!, unknownStatusUser]);

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // The unknown status row must NOT add buttons — only Alice's row may
    // contain them, but Alice is the current user so her actions are
    // suppressed → total button count is zero.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders STATUS_STYLES fallback for a user with an unknown status', async () => {
    /*
     * Scenario: a user whose status value is not in STATUS_STYLES must trigger
     * the `?? STATUS_STYLES['INACTIVE']` fallback branch so the badge still renders.
     * Protects: line 105 — `STATUS_STYLES[user.status] ?? STATUS_STYLES['INACTIVE']`
     *           null-coalescing fallback.
     */
    const unknownStatusUser: TenantUserInfo = {
      ...mockUsers[1]!,
      status: 'UNKNOWN_STATUS' as TenantUserInfo['status'],
    };
    vi.mocked(listUsers).mockResolvedValue([unknownStatusUser]);
    render(<TeamTable isAdmin={false} currentUserId="other" />);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });
    // Component renders without crashing — STATUS_STYLES fallback was applied.
    expect(screen.getByText('UNKNOWN_STATUS')).toBeDefined();
  });
});

// ── Status palette per branch + isAdmin column + button variant ──────────────

describe('TeamTable status badge palette and admin column', () => {
  it('renders the ACTIVE badge with the green palette class fragment', async () => {
    /*
     * Scenario: status colour is the user's primary visual cue. The
     * ACTIVE badge must carry the documented `text-[#22c55e]` (green)
     * fragment — pinning it defends against a regression that swapped
     * the palette map keys, which would silently paint a green
     * "Suspended" or yellow "Active".
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    const activeBadges = await screen.findAllByText('ACTIVE');
    expect(activeBadges[0]!.className).toContain('#22c55e');
  });

  it('falls back to the INACTIVE muted palette (NOT the ACTIVE green) for an unknown status', async () => {
    /*
     * Scenario: the `?? STATUS_STYLES['INACTIVE']` fallback must use the
     * MUTED palette — a regression that mutated the fallback key to
     * `'ACTIVE'` would paint the unknown badge green, hiding the fact
     * that the status is unrecognised. Pinning the negative-space
     * (NOT green, IS muted-white) defends the exact fallback choice.
     */
    const unknownStatusUser: TenantUserInfo = {
      ...mockUsers[1]!,
      status: 'UNKNOWN_STATUS' as TenantUserInfo['status'],
    };
    vi.mocked(listUsers).mockResolvedValue([unknownStatusUser]);
    render(<TeamTable isAdmin={false} currentUserId="other" />);
    const badge = await screen.findByText('UNKNOWN_STATUS');
    expect(badge.className).toContain('rgba(255,255,255,0.4)');
    expect(badge.className).not.toContain('#22c55e');
  });

  it('renders the Joined column with the "ago" suffix (formatDistanceToNow addSuffix:true)', async () => {
    /*
     * Scenario: the Joined column reads "<duration> ago" — pulling out
     * the `addSuffix: true` option would drop the suffix and the column
     * would read as a bare duration ("2 days" instead of "2 days ago").
     * Pins both the ObjectLiteral on the options object AND the
     * BooleanLiteral on the flag value.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    await screen.findByText('Alice');
    expect(document.body.textContent ?? '').toContain(' ago');
  });

  it('does NOT render the extra TableHead column when isAdmin=false', async () => {
    /*
     * Scenario: the actions column header is admin-only — member views
     * must not see an empty column. Pins the `isAdmin && <TableHead />`
     * guard by counting column headers: a `false` rendering of that
     * conditional yields 5 headers; a `true` mutant would yield 6.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin={false} currentUserId="user-1" />);
    await screen.findByText('Alice');
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(5);
  });

  it('renders the extra TableHead column when isAdmin=true', async () => {
    /*
     * Scenario: counterpart to the member view — the admin view has the
     * actions column, so 6 headers must render. Pins the truthy arm of
     * the `isAdmin && <TableHead />` guard.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin currentUserId="user-1" />);
    await screen.findByText('Alice');
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(6);
  });

  it('renders the Suspend button with the destructive red hover-palette class', async () => {
    /*
     * Scenario: Suspend is destructive — it kicks the user out until an
     * admin lifts the suspension. The button must carry the red
     * `hover:text-red-300` palette fragment so admins notice the
     * affordance. Pins the `action.variant === 'destructive'` truthy
     * branch of the className ternary AND the literal destructive class.
     */
    vi.mocked(listUsers).mockResolvedValue(mockUsers);
    render(<TeamTable isAdmin currentUserId="user-1" />);
    const suspendBtn = await screen.findByRole('button', { name: /suspend/i });
    expect(suspendBtn.className).toContain('red');
  });

  it('renders the Activate button (non-destructive) WITHOUT the red hover-palette class', async () => {
    /*
     * Scenario: Activate is a benign action — it must NOT borrow the
     * destructive palette. Pins the falsy branch of the `action.variant
     * === 'destructive'` ternary by asserting on the negative space.
     */
    const pendingUser: TenantUserInfo = { ...mockUsers[1]!, status: 'PENDING' };
    vi.mocked(listUsers).mockResolvedValue([mockUsers[0]!, pendingUser]);
    render(<TeamTable isAdmin currentUserId="user-1" />);
    const activateBtn = await screen.findByRole('button', { name: /^activate$/i });
    expect(activateBtn.className).not.toContain('red');
  });

  it("disables only the toggled row's button while updateUserStatus is in flight", async () => {
    /*
     * Scenario: the per-row `toggling === user.id` guard must lock ONLY
     * the row whose button was clicked, so an admin can fire several
     * status changes across different rows. Pins the negative space:
     * if the test fixture had two non-self rows, Bob's button must
     * stay clickable while Alice's mid-flight Suspend disables only
     * Alice's button.
     */
    const threeUsers: TenantUserInfo[] = [
      mockUsers[0]!, // current user — no button
      mockUsers[1]!, // Bob ACTIVE → Suspend button
      { ...mockUsers[1]!, id: 'user-3', name: 'Carol', email: 'carol@ex.com' }, // Carol ACTIVE → Suspend button
    ];
    vi.mocked(listUsers).mockResolvedValue(threeUsers);
    // Never resolve so the in-flight state stays observable.
    vi.mocked(updateUserStatus).mockReturnValueOnce(new Promise(() => undefined));

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await screen.findByText('Carol');

    const suspendBtns = screen
      .getAllByRole<HTMLButtonElement>('button', { name: /suspend/i })
      .filter((b) => !b.disabled);
    expect(suspendBtns).toHaveLength(2);
    // Click Bob's Suspend (first non-self button).
    fireEvent.click(suspendBtns[0]!);

    await waitFor(() => {
      const disabled = screen
        .getAllByRole<HTMLButtonElement>('button', { name: /suspend/i })
        .filter((b) => b.disabled);
      expect(disabled).toHaveLength(1);
    });
    // The OTHER row's button must still be clickable.
    const stillEnabled = screen
      .getAllByRole<HTMLButtonElement>('button', { name: /suspend/i })
      .filter((b) => !b.disabled);
    expect(stillEnabled).toHaveLength(1);
  });

  it('restores the action button (no longer disabled) after the toggle resolves', async () => {
    /*
     * Scenario: once updateUserStatus settles and the table reloads, the
     * `finally { setToggling(null) }` cleanup must fire so the per-row
     * disabled state lifts. Without it the button would stay disabled
     * after every successful action. Pins the finally cleanup.
     */
    const bobSuspended: TenantUserInfo = { ...mockUsers[1]!, status: 'SUSPENDED' };
    vi.mocked(listUsers)
      .mockResolvedValueOnce(mockUsers)
      .mockResolvedValueOnce([mockUsers[0]!, bobSuspended]);
    vi.mocked(updateUserStatus).mockResolvedValue(bobSuspended);

    render(<TeamTable isAdmin currentUserId="user-1" />);
    await screen.findByText('Bob');

    fireEvent.click(screen.getByRole('button', { name: /suspend/i }));

    // After the reload, Bob renders as SUSPENDED → his button label is "Unsuspend".
    const unsuspendBtn = await screen.findByRole<HTMLButtonElement>('button', {
      name: /unsuspend/i,
    });
    expect(unsuspendBtn.disabled).toBe(false);
  });
});
