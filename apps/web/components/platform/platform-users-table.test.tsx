/**
 * @fileoverview Unit tests for the `PlatformUsersTable` component.
 *
 * Verifies loading, empty, and populated states, the optimistic status toggle,
 * and self-suspension prevention.
 *
 * @module components/platform/platform-users-table.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/auth-client', () => ({
  listPlatformUsers: vi.fn(),
  platformUpdateUserStatus: vi.fn(),
  mapAuthClientError: vi.fn().mockReturnValue({ code: 'UNKNOWN', message: 'Error' }),
}));

vi.mock('@/lib/platform-auth', () => ({
  getPlatformAdmin: vi.fn(),
}));

vi.mock('@/lib/auth-errors', () => ({
  translateAuthError: vi.fn().mockReturnValue('Error'),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listPlatformUsers, platformUpdateUserStatus, mapAuthClientError } from '@/lib/auth-client';
import { getPlatformAdmin } from '@/lib/platform-auth';
import type { PlatformUserInfo } from '@/lib/auth-client';
import { PlatformUsersTable } from './platform-users-table.js';

const mockUsers: PlatformUserInfo[] = [
  {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'MEMBER',
    status: 'ACTIVE',
    tenantId: 'tenant-1',
    emailVerified: true,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: 'u2',
    email: 'bob@example.com',
    name: 'Bob',
    role: 'MEMBER',
    status: 'SUSPENDED',
    tenantId: 'tenant-1',
    emailVerified: false,
    mfaEnabled: false,
    lastLoginAt: null,
    createdAt: new Date(Date.now() - 172800_000).toISOString(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlatformAdmin).mockReturnValue({
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
  });
});

describe('PlatformUsersTable states', () => {
  it('shows loading text while fetching users', () => {
    /*
     * Scenario: before listPlatformUsers resolves the loading paragraph must
     * be visible.
     * Protects: isLoading guard renders loading state.
     */
    vi.mocked(listPlatformUsers).mockReturnValue(new Promise(() => undefined));
    render(<PlatformUsersTable tenantId="tenant-1" />);
    expect(screen.getByText(/loading users/i)).toBeDefined();
  });

  it('shows empty state when no users are returned', async () => {
    /*
     * Scenario: when listPlatformUsers resolves with [] the empty-state message
     * must be shown.
     * Protects: empty array condition renders the empty-state paragraph.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue([]);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByText(/no users found in this tenant/i)).toBeDefined();
    });
  });

  it('renders user names and emails in table rows', async () => {
    /*
     * Scenario: each user must appear in a table row with their name and email.
     * Protects: user data is rendered inside TableRow cells.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
      expect(screen.getByText('bob@example.com')).toBeDefined();
    });
  });

  it('shows action buttons for non-self users', async () => {
    /*
     * Scenario: rows for users who are not the current admin must have
     * action buttons (Suspend or Unsuspend depending on status).
     * Protects: non-self rows render action buttons.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      // Alice is ACTIVE → Suspend button; Bob is SUSPENDED → Unsuspend button.
      const allButtons = screen.getAllByRole('button');
      // Filter to action buttons (not navigation or other).
      const actionButtons = allButtons.filter(
        (b) => b.textContent?.includes('Suspend') || b.textContent?.includes('Unsuspend'),
      );
      expect(actionButtons.length).toBeGreaterThan(0);
    });
  });

  it('disables the action button for the current platform admin', async () => {
    /*
     * Scenario: the row for the current platform admin must show a disabled
     * button to prevent self-suspension.
     * Protects: isSelf check renders a disabled button with tooltip.
     */
    // Make the current admin be user "u1" (Alice).
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    });
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      // Alice's button must be disabled.
      const suspendButtons = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-label') !== 'Open navigation menu');
      const disabledBtn = suspendButtons.find((b) => (b as HTMLButtonElement).disabled);
      expect(disabledBtn).toBeDefined();
    });
  });
});

describe('PlatformUsersTable error path', () => {
  it('shows error toast when listPlatformUsers rejects', async () => {
    /*
     * Scenario: when the initial load fails mapAuthClientError maps the error
     * and toast.error is called with the translated message.
     * Protects: lines 74-75 — catch block in load() calls mapAuthClientError
     * and toast.error with translateAuthError.
     */
    const { toast } = await import('sonner');
    vi.mocked(listPlatformUsers).mockRejectedValue(new Error('Network error'));
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });
});

describe('PlatformUsersTable additional branches', () => {
  it('currentAdminId falls back to null when getPlatformAdmin returns null', async () => {
    /*
     * Scenario: when getPlatformAdmin() returns null the optional-chain `.id`
     * returns undefined and the `?? null` fallback fires, setting currentAdminId
     * to null so all users get non-self action buttons.
     * Protects: line 66 — `getPlatformAdmin()?.id ?? null` null-coalescing branch.
     */
    vi.mocked(getPlatformAdmin).mockReturnValue(null);
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      // With no current admin, both users get action buttons (none are self).
      expect(screen.getByText('Alice')).toBeDefined();
    });
  });

  it('uses non-UNKNOWN error code in load() catch branch (line 75 false branch)', async () => {
    /*
     * Scenario: when mapAuthClientError returns a non-UNKNOWN code the
     * `code === 'UNKNOWN' ? '' : code` false branch fires.
     * Protects: line 75 — `code !== 'UNKNOWN'` branch in load() catch.
     */
    const { toast } = await import('sonner');
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockImplementation(() => ({
      code: 'auth.invalid_credentials',
      message: 'Invalid',
    }));
    vi.mocked(listPlatformUsers).mockRejectedValue(new Error('API error'));
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('auth.invalid_credentials');
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });

  it('passes ACTIVE as newStatus and shows correct toast when toggling a SUSPENDED user', async () => {
    /*
     * Scenario: clicking the action button for a SUSPENDED user computes
     * newStatus = 'ACTIVE' (the `=== 'SUSPENDED' ? 'ACTIVE'` true branch).
     * Protects: line 86 — `user.status === 'SUSPENDED'` true branch.
     */
    const updatedBob: PlatformUserInfo = { ...mockUsers[1]!, status: 'ACTIVE' };
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockResolvedValue(updatedBob);

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Bob')).toBeDefined());

    // Bob is SUSPENDED → button label for non-self is 'Unsuspend'.
    const allButtons = screen.getAllByRole('button');
    const unsuspendBtn = allButtons.find(
      (b) => b.textContent === 'Unsuspend' && !(b as HTMLButtonElement).disabled,
    );
    expect(unsuspendBtn).toBeDefined();
    fireEvent.click(unsuspendBtn!);

    await waitFor(() => {
      expect(platformUpdateUserStatus).toHaveBeenCalledWith('u2', 'ACTIVE');
    });
  });

  it('uses non-UNKNOWN error code in handleToggle() catch branch (line 104 false branch)', async () => {
    /*
     * Scenario: when platformUpdateUserStatus fails and mapAuthClientError returns
     * a non-UNKNOWN code, the `code !== 'UNKNOWN'` branch fires, passing the
     * actual code to translateAuthError instead of an empty string.
     * Protects: line 104 — `code === 'UNKNOWN' ? '' : code` false branch in handleToggle.
     */
    const { toast } = await import('sonner');
    const { translateAuthError } = await import('@/lib/auth-errors');
    // Return a non-UNKNOWN code to trigger the false-branch of `code === 'UNKNOWN' ? '' : code`.
    vi.mocked(mapAuthClientError).mockImplementation(() => ({
      code: 'auth.forbidden',
      message: 'Forbidden',
    }));
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockRejectedValue(new Error('Forbidden'));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const allButtons = screen.getAllByRole('button');
    const suspendBtn = allButtons.find(
      (b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      // translateAuthError must be called with the actual code (not '') to confirm
      // the false-branch was taken.
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('auth.forbidden');
      expect(vi.mocked(toast).error).toHaveBeenCalled();
    });
  });

  it('renders STATUS_STYLES fallback for a user with an unknown status (line 145)', async () => {
    /*
     * Scenario: a user with a status value not in STATUS_STYLES triggers the
     * `?? STATUS_STYLES['INACTIVE']` fallback so the badge still renders.
     * Protects: line 145 — `STATUS_STYLES[user.status] ?? STATUS_STYLES['INACTIVE']` fallback.
     */
    const unknownUser: PlatformUserInfo = {
      ...mockUsers[0]!,
      status: 'UNKNOWN_STATUS' as PlatformUserInfo['status'],
    };
    vi.mocked(listPlatformUsers).mockResolvedValue([unknownUser]);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeDefined();
    });
    // Component renders without crashing when status has no matching style.
    expect(screen.getByText('Unknown_status')).toBeDefined();
  });

  it('renders "Unsuspend" text in disabled self-button when the self user is SUSPENDED (line 182)', async () => {
    /*
     * Scenario: when the current admin is SUSPENDED the disabled self-row button
     * must show "Unsuspend" — the `isSuspended ? 'Unsuspend'` true branch.
     * Protects: line 182 — `isSuspended ? 'Unsuspend' : 'Suspend'` true branch.
     */
    // Make current admin be Bob (u2 — SUSPENDED).
    vi.mocked(getPlatformAdmin).mockReturnValue({
      id: 'u2',
      email: 'bob@example.com',
      name: 'Bob',
      role: 'SUPER_ADMIN',
      status: 'SUSPENDED',
    });
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(screen.getByText('Bob')).toBeDefined();
    });
    // Bob's row is the self-row — the disabled button must show "Unsuspend".
    const disabledBtns = screen
      .getAllByRole('button')
      .filter((b) => (b as HTMLButtonElement).disabled);
    const hasUnsuspend = disabledBtns.some((b) => b.textContent?.includes('Unsuspend'));
    expect(hasUnsuspend).toBe(true);
  });
});

describe('PlatformUsersTable optimistic toggle', () => {
  it('calls platformUpdateUserStatus and confirms with server response on success', async () => {
    /*
     * Scenario: clicking Suspend for Alice must call platformUpdateUserStatus and
     * update the row to the server-confirmed status.
     * Protects: handleToggle optimistic update + server confirmation path (lines 86-97).
     */
    const updatedAlice: PlatformUserInfo = { ...mockUsers[0]!, status: 'SUSPENDED' };
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockResolvedValue(updatedAlice);

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    // Alice is ACTIVE — click Suspend (non-self button, not disabled).
    const allButtons = screen.getAllByRole('button');
    const suspendBtn = allButtons.find(
      (b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled,
    );
    expect(suspendBtn).toBeDefined();
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      expect(platformUpdateUserStatus).toHaveBeenCalledWith('u1', 'SUSPENDED');
    });
    // Server confirms SUSPENDED — both Alice (was ACTIVE) and Bob (already SUSPENDED)
    // now show "Suspended", so expect at least two occurrences.
    await waitFor(() => {
      expect(screen.getAllByText('Suspended').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('rolls back optimistic update when platformUpdateUserStatus throws', async () => {
    /*
     * Scenario: when the API call fails the row must revert to its previous status.
     * Also covers the `code === 'UNKNOWN' ? ''` true-branch at line 104.
     * Protects: catch branch in handleToggle restores previousStatus (lines 99-104).
     */
    vi.mocked(mapAuthClientError).mockImplementation(() => ({ code: 'UNKNOWN', message: 'Error' }));
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockRejectedValue(new Error('API error'));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const allButtons = screen.getAllByRole('button');
    const suspendBtn = allButtons.find(
      (b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled,
    );
    expect(suspendBtn).toBeDefined();
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      expect(platformUpdateUserStatus).toHaveBeenCalled();
    });
    // After rollback Alice must still show Active (the optimistic update is reversed).
    await waitFor(() => {
      expect(screen.getByText('Active')).toBeDefined();
    });
  });
});

// ── Toast verbatim + lowercase status ─────────────────────────────────────────

describe('PlatformUsersTable success toast', () => {
  it('toasts the verbatim "User <email> is now <status-lowercase>." message after a successful toggle', async () => {
    /*
     * Scenario: support docs and audit-log dashboards pattern-match on this
     * exact line. Pinning the verbatim template AND the `.toLowerCase()`
     * call defends both: a regression that drops the email or hardens the
     * status to uppercase would silently break those external consumers.
     */
    const updatedAlice: PlatformUserInfo = { ...mockUsers[0]!, status: 'SUSPENDED' };
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockResolvedValue(updatedAlice);
    const { toast } = await import('sonner');

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const allButtons = screen.getAllByRole('button');
    const suspendBtn = allButtons.find(
      (b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      expect(vi.mocked(toast).success).toHaveBeenCalledWith(
        'User alice@example.com is now suspended.',
      );
    });
  });
});

// ── Status badge palette ──────────────────────────────────────────────────────

describe('PlatformUsersTable status badge palette', () => {
  it('renders the ACTIVE badge with the green-palette className from STATUS_STYLES', async () => {
    /*
     * Scenario: the colour of the status badge is the user's quickest visual
     * cue. The ACTIVE palette must carry the documented `text-[#22c55e]`
     * fragment — a regression that swapped the palette map keys would
     * silently produce a green "Suspended" badge or a yellow "Active" one,
     * a serious UX defect on the platform admin page.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Active')).toBeDefined());

    const activeBadge = screen.getByText('Active');
    expect(activeBadge.className).toContain('#22c55e');
  });

  it('renders the SUSPENDED badge with the amber-palette className', async () => {
    /*
     * Scenario: counterpart to the ACTIVE-palette test — the SUSPENDED
     * arm of the STATUS_STYLES map must carry the documented
     * `text-[#eab308]` (amber) fragment. Defends the SUSPENDED arm of
     * the palette table independently.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Suspended')).toBeDefined());

    const suspendedBadge = screen.getByText('Suspended');
    expect(suspendedBadge.className).toContain('#eab308');
  });

  it('falls back to the INACTIVE muted palette for an unknown status', async () => {
    /*
     * Scenario: when a future status value not in STATUS_STYLES appears
     * (or after a bad backend deploy), the badge must still render with
     * a muted fallback rather than a missing-className blank pill.
     * Pinning the `?? STATUS_STYLES['INACTIVE']` fallback by asserting
     * the muted text fragment on a synthetic unknown status.
     */
    const unknownUser: PlatformUserInfo = {
      ...mockUsers[0]!,
      status: 'UNKNOWN_STATUS' as PlatformUserInfo['status'],
    };
    vi.mocked(listPlatformUsers).mockResolvedValue([unknownUser]);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Unknown_status')).toBeDefined());

    const badge = screen.getByText('Unknown_status');
    // The INACTIVE fallback uses the muted white-translucent text colour.
    expect(badge.className).toContain('rgba(255,255,255,0.4)');
  });
});

// ── Toggle pending UI ─────────────────────────────────────────────────────────

describe('PlatformUsersTable in-flight toggle', () => {
  it('shows the "…" placeholder text on the toggled row\'s button while the API call is pending', async () => {
    /*
     * Scenario: the optimistic-update window is visible to the user — they
     * must see the spinner-equivalent "…" so they know the click landed
     * and a retry is unnecessary. Pinning the `'…'` literal AND the
     * `toggling === user.id` per-row guard defends both the in-flight UX
     * and the per-row isolation of the toggling state.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    // Never resolve so the button stays in the in-flight state we observe.
    vi.mocked(platformUpdateUserStatus).mockReturnValueOnce(new Promise(() => undefined));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const allButtons = screen.getAllByRole('button');
    const suspendBtn = allButtons.find(
      (b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled,
    );
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      const dotsBtn = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '…' && (b as HTMLButtonElement).disabled);
      expect(dotsBtn).toBeDefined();
    });
  });

  it('restores the action button label (no more "…") after the toggle resolves successfully', async () => {
    /*
     * Scenario: the `…` placeholder is the in-flight affordance and MUST
     * disappear once the API response settles. Pins the `finally {
     * setToggling(null) }` cleanup — without it, the button text stays
     * on `…` after the user's action completes, looking like the page
     * is permanently stuck.
     */
    const updatedAlice: PlatformUserInfo = { ...mockUsers[0]!, status: 'SUSPENDED' };
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockResolvedValue(updatedAlice);

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const suspendBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled);
    fireEvent.click(suspendBtn!);

    // Wait for the API call to land + state to settle.
    await waitFor(() => {
      expect(platformUpdateUserStatus).toHaveBeenCalledWith('u1', 'SUSPENDED');
    });
    // After settle, no button should still show the pending `…` placeholder.
    await waitFor(() => {
      const dotsButton = screen.queryAllByRole('button').find((b) => b.textContent === '…');
      expect(dotsButton).toBeUndefined();
    });
  });

  it("disables ONLY the toggled row's button while the API call is pending, not every row", async () => {
    /*
     * Scenario: the platform admin is allowed to fire several toggles
     * across different rows in parallel. The `toggling === user.id`
     * per-row guard must lock ONLY the row whose button was clicked.
     * Pinning the negative space: Bob's button must remain interactive
     * while Alice's toggle is mid-flight.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockReturnValueOnce(new Promise(() => undefined));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    // Click Alice's Suspend button.
    const suspendBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled);
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      // Alice's button now reads "…" and is disabled.
      const dots = screen
        .getAllByRole('button')
        .find((b) => b.textContent === '…' && (b as HTMLButtonElement).disabled);
      expect(dots).toBeDefined();
    });
    // Bob's Unsuspend button must still be clickable.
    const unsuspendBtn = screen.getAllByRole('button').find((b) => b.textContent === 'Unsuspend');
    expect(unsuspendBtn).toBeDefined();
    expect((unsuspendBtn as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── UNKNOWN error code → empty string forwarded to translateAuthError ────────

describe('PlatformUsersTable UNKNOWN error normalisation', () => {
  it('forwards an EMPTY string to translateAuthError when mapAuthClientError returns UNKNOWN (load path)', async () => {
    /*
     * Scenario: the UNKNOWN error code is the lib's "I do not have a more
     * specific reason" sentinel. The component normalises it to the empty
     * string before handing it to translateAuthError so the user sees the
     * generic fallback copy rather than the literal "UNKNOWN" code. Pinning
     * the empty-string arg specifically defends the `code === 'UNKNOWN' ? ''
     * : code` ternary in the load() catch — without this assertion, a
     * regression returning the literal string `code` to translateAuthError
     * would slip through silently.
     */
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockImplementation(() => ({
      code: 'UNKNOWN',
      message: 'Generic',
    }));
    vi.mocked(listPlatformUsers).mockRejectedValue(new Error('boom'));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => {
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('');
    });
  });

  it('forwards an EMPTY string to translateAuthError when mapAuthClientError returns UNKNOWN (toggle path)', async () => {
    /*
     * Scenario: same UNKNOWN-normalisation contract on the handleToggle
     * catch branch. Pinned independently so a future refactor cannot
     * branch the normalisation per code-path.
     */
    const { translateAuthError } = await import('@/lib/auth-errors');
    vi.mocked(mapAuthClientError).mockImplementation(() => ({
      code: 'UNKNOWN',
      message: 'Generic',
    }));
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    vi.mocked(platformUpdateUserStatus).mockRejectedValue(new Error('Forbidden'));

    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    const suspendBtn = screen
      .getAllByRole('button')
      .find((b) => b.textContent === 'Suspend' && !(b as HTMLButtonElement).disabled);
    fireEvent.click(suspendBtn!);

    await waitFor(() => {
      expect(vi.mocked(translateAuthError)).toHaveBeenCalledWith('');
    });
  });
});

// ── Created timestamp ─────────────────────────────────────────────────────────

describe('PlatformUsersTable created timestamp', () => {
  it('renders relative time with the "ago" suffix (formatDistanceToNow addSuffix:true)', async () => {
    /*
     * Scenario: the Created column is human-readable relative time —
     * "2 days ago" not "2 days". Pinning the "ago" suffix defends the
     * `{ addSuffix: true }` option passed to `formatDistanceToNow` — a
     * regression to `{}` or `{ addSuffix: false }` would drop the
     * suffix and the column would read as a bare duration.
     */
    vi.mocked(listPlatformUsers).mockResolvedValue(mockUsers);
    render(<PlatformUsersTable tenantId="tenant-1" />);
    await waitFor(() => expect(screen.getByText('Alice')).toBeDefined());

    // At least one cell must contain the relative-time "ago" suffix.
    expect(document.body.textContent ?? '').toContain(' ago');
  });
});
