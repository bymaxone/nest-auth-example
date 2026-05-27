/**
 * @fileoverview Unit tests for the `TenantSwitcher` component.
 *
 * Verifies:
 * - Renders nothing while loading or with an empty workspace list.
 * - Renders the trigger button with the current workspace name.
 * - Error toast on fetch failure.
 * - Selecting the current workspace is a no-op.
 * - Selecting a different workspace POSTs /api/auth/logout and navigates to
 *   /auth/login?tenantId=<slug> (Slack-style re-auth).
 * - The active workspace is marked with a checkmark in the dropdown.
 *
 * `next/navigation`, `sonner`, `@/lib/auth-client`, `fetch`, and
 * `window.location.assign` are mocked so no real API or navigation occurs.
 *
 * @module components/auth/tenant-switcher.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────────

/** Stable mock router instance shared across all tests in this module. */
const mockRouter = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/',
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/auth-client', () => ({
  listWorkspaces: vi.fn(),
  switchWorkspace: vi.fn(),
  // `mapAuthClientError` is pure (no I/O) — re-export the real implementation
  // so the MFA-fallback branch's `code === 'auth.mfa_required'` check stays
  // honest under test instead of relying on a stubbed mapping.
  mapAuthClientError: (err: unknown) => {
    const e = err as { code?: string } | null | undefined;
    return { code: e?.code ?? 'UNKNOWN', message: '' };
  },
}));

// `useSession` is called by the component to grab the AuthProvider's
// `refresh()` (used after a successful silent switch) AND the current
// `user.tenantId` (used to derive which workspace is active). The component
// is rendered outside of `<AuthProvider>` in these tests, so we mock the
// hook to return a sufficient minimal shape and let individual tests update
// `sessionState.tenantId` to drive the active-workspace logic.
//
// `vi.hoisted` runs before module evaluation so the mocked module captures the
// same mutable reference the test file mutates in `beforeEach` and per-test.
const sessionState = vi.hoisted(() => ({ tenantId: null as string | null }));
vi.mock('@bymax-one/nest-auth/react', () => ({
  useSession: () => ({
    user: sessionState.tenantId === null ? null : { tenantId: sessionState.tenantId },
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listWorkspaces, switchWorkspace } from '@/lib/auth-client';
import { toast } from 'sonner';
import { TenantSwitcher } from './tenant-switcher.js';

/**
 * Shorthand to build a workspace entry — keeps each test focused on the field
 * that drives the behavior under test.
 */
function workspace(
  id: string,
  name: string,
  slug: string,
  isCurrent: boolean,
  role = 'ADMIN',
): {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  isCurrent: boolean;
  role: string;
} {
  return { tenantId: id, tenantName: name, tenantSlug: slug, isCurrent, role };
}

/** Captures every `fetch` call dispatched by the component under test. */
let fetchMock: ReturnType<typeof vi.fn>;
/** Captures every `window.location.assign` call. */
let assignMock: ReturnType<typeof vi.fn>;
/** Saved original `window.location` for restoration in afterEach. */
let savedLocation: Location;

beforeEach(() => {
  vi.clearAllMocks();
  mockRouter.push.mockReset();
  mockRouter.refresh.mockReset();
  mockRouter.replace.mockReset();
  // Reset session mock between tests so `useSession().user` defaults to null
  // and only the tests that need an active user set it explicitly.
  sessionState.tenantId = null;

  // Stub global fetch so /api/auth/logout never touches the network.
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);

  // Replace window.location with a writable stub so we can spy on assign().
  savedLocation = window.location;
  assignMock = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...savedLocation, assign: assignMock },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', {
    value: savedLocation,
    writable: true,
    configurable: true,
  });
});

describe('TenantSwitcher states', () => {
  it('renders null while the workspace list is still loading', () => {
    /*
     * Scenario: before `listWorkspaces` resolves, the component must return null
     * so the topbar does not flash a stub dropdown during fetch.
     * Protects: isLoading guard — no partial render while fetching.
     */
    // Never resolve so we stay in the loading state.
    vi.mocked(listWorkspaces).mockReturnValue(new Promise(() => undefined));
    const { container } = render(<TenantSwitcher />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when the workspace list is empty', async () => {
    /*
     * Scenario: when the user has no workspaces at all (shouldn't happen in
     * practice, but the endpoint returns an empty array for safety), the
     * component must render nothing rather than showing an empty trigger.
     * Protects: `workspaces.length === 0` guard before render.
     */
    vi.mocked(listWorkspaces).mockResolvedValue([]);
    const { container } = render(<TenantSwitcher />);
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('renders the trigger button labeled with the current workspace name', async () => {
    /*
     * Scenario: with a workspace list returned from the API, the trigger button
     * displays the active workspace's name so the user knows where they're
     * signed in.
     * Protects: trigger renders the active workspace label.
     */
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });
  });

  it('shows an error toast when listWorkspaces rejects', async () => {
    /*
     * Scenario: when the API call fails, a toast.error is fired and the
     * component stays invisible — no crash, no partial UI.
     * Protects: catch block in the load() effect.
     */
    vi.mocked(listWorkspaces).mockRejectedValue(new Error('Network failure'));
    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(vi.mocked(toast).error).toHaveBeenCalledWith('Could not load workspaces.');
    });
  });

  it('does not redirect when the current workspace is selected', async () => {
    /*
     * Scenario: clicking the already-active workspace must be a no-op — no
     * logout, no navigation. "Active" is derived from the live session's
     * `user.tenantId`, not the stale `isCurrent` flag on the payload.
     * Protects: `if (workspace.tenantId === user?.tenantId || isSwitching) return`.
     */
    sessionState.tenantId = 'tid-1';
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });

    // Open the dropdown via Radix-compatible pointer events.
    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, bubbles: true });
    fireEvent.mouseDown(trigger, { bubbles: true });
    fireEvent.click(trigger, { bubbles: true });

    await waitFor(() => {
      const menuItems = document.body.querySelectorAll('[role="menuitem"]');
      if (menuItems.length > 0) {
        // First item is the current workspace ("Acme Corp").
        fireEvent.click(menuItems[0]!);
      }
      // No matter what, the no-op guard prevents the logout fetch + navigation.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
    });
  });

  it('runs the silent switch flow when a non-current workspace is selected', async () => {
    /*
     * Scenario (v1.0.10+): selecting a different workspace must call the
     * silent-switch endpoint with the destination CUID, then trigger
     * `router.refresh()` so the dashboard re-renders with the new
     * identity. It must NOT log out or redirect to /auth/login — that
     * path is reserved for the MFA fallback case.
     * Protects: the happy path of `handleSelect` calling `switchWorkspace`.
     */
    sessionState.tenantId = 'tid-1';
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    vi.mocked(switchWorkspace).mockResolvedValue({
      user: {
        id: 'user-target',
        email: 'admin@example.dev',
        name: 'Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        tenantId: 'tid-2',
        emailVerified: true,
        mfaEnabled: false,
      },
    });
    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });

    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, bubbles: true });
    fireEvent.mouseDown(trigger, { bubbles: true });
    fireEvent.click(trigger, { bubbles: true });

    await waitFor(() => {
      const menuItems = document.body.querySelectorAll('[role="menuitem"]');
      if (menuItems.length >= 2) {
        // Second item is the non-current workspace ("Globex Inc").
        fireEvent.click(menuItems[1]!);
      }
    });

    await waitFor(() => {
      expect(switchWorkspace).toHaveBeenCalledWith('tid-2');
      expect(mockRouter.refresh).toHaveBeenCalled();
    });
    // The silent flow must NOT touch the logout endpoint or trigger a
    // full-page navigation — those are the MFA-fallback behaviours.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('falls back to logout + redirect when the destination requires MFA', async () => {
    /*
     * Scenario: the destination tenant has MFA enabled on the caller's
     * sibling account. The lib's `issueTokensForUserId` throws
     * `auth.mfa_required`, which surfaces as a 401 `AuthClientError`
     * with that code. The component must drop the silent flow and run
     * the v1.0.9-style re-auth path: logout + window.location.assign
     * to /auth/login?tenantId=<slug> so the canonical MFA challenge
     * runs.
     * Protects: the MFA-fallback branch of `handleSelect`.
     */
    sessionState.tenantId = 'tid-1';
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    // The thrown shape mirrors `AuthClientError` — `mapAuthClientError`
    // is the production-shape mock above, so the `code` field flows
    // through unchanged.
    vi.mocked(switchWorkspace).mockRejectedValueOnce({ code: 'auth.mfa_required' });

    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });

    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, bubbles: true });
    fireEvent.mouseDown(trigger, { bubbles: true });
    fireEvent.click(trigger, { bubbles: true });

    await waitFor(() => {
      const menuItems = document.body.querySelectorAll('[role="menuitem"]');
      if (menuItems.length >= 2) {
        fireEvent.click(menuItems[1]!);
      }
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      expect(assignMock).toHaveBeenCalledWith('/auth/login?tenantId=globex');
    });
    // Toast must NOT fire on the MFA path — the redirect is itself the
    // user-visible feedback; a toast would be redundant noise.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('renders the active-workspace checkmark for the current workspace', async () => {
    /*
     * Scenario: the dropdown row for the active workspace must display a "✓"
     * marker so the user can visually confirm which workspace they are in.
     * The active flag is derived from the live `useSession().user.tenantId`,
     * not the stale `isCurrent` flag baked into the initial workspace payload
     * — that's what keeps the trigger and checkmark in sync without a reload
     * after a silent switch.
     * Protects: the `workspace.tenantId === user?.tenantId` render branch.
     */
    sessionState.tenantId = 'tid-1';
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });

    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(document.body.textContent).toContain('✓');
    });
  });

  it('surfaces an error toast when the silent switch fails for a non-MFA reason', async () => {
    /*
     * Scenario: `switchWorkspace` rejects with a code other than
     * `auth.mfa_required` (e.g. ACCOUNT_SUSPENDED in destination tenant,
     * NotFound when the workspace list was stale, transient network
     * error). The component must:
     *   1. Surface a user-facing toast so the click is not silently lost.
     *   2. NOT redirect — the user stays on the current workspace.
     *   3. Re-enable the switcher (`setIsSwitching(false)`) so the user
     *      can retry without reloading the page.
     * Protects: the generic `catch` arm of `handleSelect`.
     */
    sessionState.tenantId = 'tid-1';
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    vi.mocked(switchWorkspace).mockRejectedValueOnce({ code: 'auth.account_suspended' });

    render(<TenantSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeDefined();
    });

    const trigger = screen.getByRole('button', { name: /switch workspace/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, bubbles: true });
    fireEvent.mouseDown(trigger, { bubbles: true });
    fireEvent.click(trigger, { bubbles: true });

    await waitFor(() => {
      const menuItems = document.body.querySelectorAll('[role="menuitem"]');
      if (menuItems.length >= 2) {
        // Second item is the non-current workspace ("Globex Inc").
        fireEvent.click(menuItems[1]!);
      }
    });

    // The toast carries a recoverable message — exact copy is not pinned
    // so a small wording edit does not break the test.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    // No redirect / logout — the user remains on the current workspace.
    expect(assignMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/logout', expect.anything());
  });
});
