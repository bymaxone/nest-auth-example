/**
 * @fileoverview Workspace switcher dropdown for the dashboard topbar.
 *
 * Fetches every workspace the signed-in user's email has access to from
 * `GET /api/account/workspaces`. Selecting a different workspace triggers
 * the **silent switch** flow (lib v1.0.10+):
 *
 *   1. Frontend POSTs `/api/account/switch-workspace` with the destination
 *      tenant CUID.
 *   2. API validates the caller's email has an ACTIVE sibling `User` row
 *      in that tenant (same email, distinct row, distinct password / MFA /
 *      role — exactly the Slack model).
 *   3. API calls the lib's `AuthService.issueTokensForUserId` to mint a
 *      session for the target row without a password, and delivers the
 *      cookies via `TokenDeliveryService.deliverAuthResponse`.
 *   4. Frontend re-fetches the session (`useSession().refresh()`) and
 *      reloads the dashboard so the new identity propagates to every
 *      component that reads from `useSession()` / RSCs.
 *
 * **Fallback to login.** If the destination account has MFA enabled, the
 * lib throws `MFA_REQUIRED` (HTTP 401, `code: 'auth.mfa_required'`). The
 * silent flow cannot complete in that case — we fall back to the v1.0.9-
 * style behaviour: full logout + redirect to `/auth/login?tenantId=<slug>`
 * so the user completes the destination tenant's MFA challenge through
 * the canonical password-login flow.
 *
 * Covers FCM row #20 (multi-tenant workspace switching).
 *
 * @layer components/auth
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useSession } from '@bymax-one/nest-auth/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { listWorkspaces, mapAuthClientError, switchWorkspace } from '@/lib/auth-client';
import type { WorkspaceInfo } from '@/lib/auth-client';

/**
 * Fallback flow when the silent switch cannot complete (typically because
 * the destination account has MFA enabled). Clears the current session via
 * the lib's logout endpoint, then navigates to the destination tenant's
 * login page where the MFA challenge runs through the canonical flow.
 *
 * @param tenantSlug - URL-safe slug of the destination workspace.
 */
async function signOutAndGoToLogin(tenantSlug: string): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  // Full-page navigation so any in-memory React state (caches, AuthProvider
  // session) is discarded before the user lands on the destination login.
  window.location.assign(`/auth/login?tenantId=${encodeURIComponent(tenantSlug)}`);
}

/**
 * Dropdown that lists every workspace the user can sign into and triggers a
 * logout-then-login redirect when a non-current workspace is selected.
 *
 * Renders nothing while the workspace list is loading. On fetch failure a
 * toast is shown and the component stays invisible so it never blocks the
 * topbar layout.
 */
export function TenantSwitcher() {
  const router = useRouter();
  // `refresh()` re-fetches `/api/auth/me` so the AuthProvider's `user` matches
  // the destination tenant immediately after the silent switch — without this
  // the dashboard renders one extra frame with the previous identity (role
  // gates flicker, tenant-scoped queries fire against the wrong tenantId).
  // `user.tenantId` is also read so the dropdown trigger reflects the active
  // workspace without depending on the stale `isCurrent` flag baked into the
  // initial `listWorkspaces()` payload.
  const { user, refresh } = useSession();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    /** Loads the workspace list for the signed-in user. */
    const load = async () => {
      try {
        const list = await listWorkspaces();
        setWorkspaces(list);
      } catch {
        toast.error('Could not load workspaces.');
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  /**
   * Handles selection of a workspace.
   *
   * Selecting the current workspace is a no-op (closes the dropdown).
   * Selecting any other workspace triggers the silent-switch flow (lib
   * v1.0.10+): the API mints a fresh session for the sibling `User` row in
   * the destination tenant, the browser's cookies rotate, and the page
   * reloads with the new identity. No password re-entry, no redirect to
   * the login screen.
   *
   * **MFA fallback.** If the destination account has MFA enabled, the lib
   * throws `MFA_REQUIRED`. The silent flow cannot complete with cookies
   * alone — we fall back to `signOutAndGoToLogin` so the user completes
   * the destination tenant's MFA challenge through the canonical flow.
   * Other lib errors (account_suspended, etc.) surface as a toast.
   *
   * @param workspace - The chosen workspace.
   */
  const handleSelect = (workspace: WorkspaceInfo) => {
    if (workspace.tenantId === user?.tenantId || isSwitching) return;
    setIsSwitching(true);
    void (async () => {
      try {
        await switchWorkspace(workspace.tenantId);
        // Re-fetch the workspace list so the dropdown's `isCurrent` flags
        // mirror the new session — without this, the trigger and checkmark
        // would still point at the previous tenant until a full reload.
        const updatedList = await listWorkspaces();
        setWorkspaces(updatedList);
        // Reset the AuthProvider's session so every component that reads
        // from `useSession()` sees the destination identity, then invalidate
        // RSC caches so server-rendered pages re-fetch with the new tenant.
        await refresh();
        router.refresh();
        setIsSwitching(false);
      } catch (err) {
        const { code } = mapAuthClientError(err);
        if (code === 'auth.mfa_required') {
          // Destination tenant requires MFA on this account — silent path
          // cannot complete. Fall back to the v1.0.9 re-auth flow so the
          // user enters their TOTP through the canonical challenge page.
          await signOutAndGoToLogin(workspace.tenantSlug);
          return;
        }
        toast.error('Could not switch workspace. Please try again.');
        setIsSwitching(false);
      }
    })();
  };

  // Derive the active workspace from the live session's `tenantId` so the
  // topbar updates immediately after `refresh()` — relying on the
  // `isCurrent` flag baked into the initial `listWorkspaces()` payload would
  // make the trigger lag a full reload behind the actual session. The first
  // entry from the API is the fallback while the session is still loading
  // (the API returns workspaces sorted with the current one first).
  const activeWorkspace = workspaces.find((w) => w.tenantId === user?.tenantId) ?? workspaces[0];

  if (isLoading || workspaces.length === 0 || activeWorkspace === undefined) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 items-center gap-1.5 border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2.5 text-xs font-medium text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.08)] hover:text-white lg:flex"
          aria-label="Switch workspace"
          disabled={isSwitching}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-[#ff6224]" />
          <span className="max-w-[120px] truncate">{activeWorkspace.tenantName}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56 border-[rgba(255,255,255,0.08)] bg-[rgba(18,18,18,0.98)] backdrop-blur-md"
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.35)]">
          Workspaces
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[rgba(255,255,255,0.06)]" />

        {workspaces.map((workspace) => {
          // Use the live session's `tenantId` as the source of truth — the
          // payload's `isCurrent` flag is stale once a silent switch lands.
          const isActive = workspace.tenantId === user?.tenantId;
          return (
            <DropdownMenuItem
              key={workspace.tenantId}
              onClick={() => handleSelect(workspace)}
              className={
                isActive
                  ? 'cursor-default text-[#ff6224] focus:bg-[rgba(255,98,36,0.1)] focus:text-[#ff6224]'
                  : 'cursor-pointer text-[rgba(255,255,255,0.7)] focus:bg-[rgba(255,255,255,0.05)] focus:text-white'
              }
            >
              <Building2 className="mr-2 h-3.5 w-3.5 shrink-0" />
              <div className="flex flex-1 flex-col">
                <span className="truncate text-sm leading-tight">{workspace.tenantName}</span>
                <span className="truncate text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.35)]">
                  {workspace.role.toLowerCase()}
                </span>
              </div>
              {isActive && <span className="ml-auto text-[10px] text-[#ff6224]">✓</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
