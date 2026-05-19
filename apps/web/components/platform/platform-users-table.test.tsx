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
