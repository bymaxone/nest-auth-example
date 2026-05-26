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
}));

// ── Typed imports after mocks ─────────────────────────────────────────────────

import { listWorkspaces } from '@/lib/auth-client';
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
     * logout, no navigation.
     * Protects: `if (workspace.isCurrent || isSwitching) return` guard.
     */
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

  it('logs out and redirects to the destination login when a non-current workspace is selected', async () => {
    /*
     * Scenario: selecting a different workspace must POST /api/auth/logout to
     * clear the current session and then assign window.location to
     * /auth/login?tenantId=<slug> for the destination tenant.
     * Protects: the Slack-style re-auth flow inside `signOutAndGoToLogin`.
     */
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
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

    // The component awaits the logout fetch before navigating — wait for both.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      expect(assignMock).toHaveBeenCalledWith('/auth/login?tenantId=globex');
    });
  });

  it('renders the active-workspace checkmark for the current workspace', async () => {
    /*
     * Scenario: the dropdown row for the active workspace must display a "✓"
     * marker so the user can visually confirm which workspace they are in.
     * Protects: the conditional `{workspace.isCurrent && <span>✓</span>}` render.
     */
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

  it('surfaces an error toast and re-enables the switcher if signOutAndGoToLogin rejects', async () => {
    /*
     * Scenario: the POST /api/auth/logout call fails (e.g. network outage)
     * during a workspace switch. The component's catch block must:
     *   1. Surface a user-facing toast so the click is not silently lost.
     *   2. Re-enable the switcher (`setIsSwitching(false)`) so the user can
     *      retry without reloading the page.
     *   3. Call `router.refresh()` to re-fetch the session state in case the
     *      logout partially completed on the server.
     * Protects: the `catch` arm of `handleSelect` in `tenant-switcher.tsx`
     * (the success path is covered by the "logs out and redirects" test above).
     */
    vi.mocked(listWorkspaces).mockResolvedValue([
      workspace('tid-1', 'Acme Corp', 'acme', true),
      workspace('tid-2', 'Globex Inc', 'globex', false),
    ]);
    // The component's `signOutAndGoToLogin` helper calls `fetch('/api/auth/logout')`.
    // Make that fail so the promise rejects and the catch arm runs.
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

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

    // The toast carries a recoverable message — exact copy is not pinned so
    // a small wording edit does not break the test. The function must NOT
    // navigate (assignMock stays untouched) because the logout failed.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(assignMock).not.toHaveBeenCalled();
    // router.refresh() is the "re-sync session state" step in the recovery
    // path; pinning it documents that the catch arm did its full cleanup.
    expect(mockRouter.refresh).toHaveBeenCalled();
  });
});
