/**
 * @fileoverview Workspace switcher dropdown for the dashboard topbar.
 *
 * Fetches every workspace the signed-in user's email has access to from
 * `GET /api/account/workspaces`. Because `@bymax-one/nest-auth` binds one JWT
 * to one tenant by design, switching workspaces is not a live context swap —
 * it is a Slack-style re-authentication:
 *
 *   1. The dropdown lists each workspace (with the current one marked).
 *   2. Selecting a different workspace POSTs `/api/auth/logout` (the library's
 *      `createLogoutHandler` clears every auth cookie).
 *   3. The page then navigates to `/auth/login?tenantId=<slug>` where the user
 *      authenticates against the destination tenant's distinct `User` row.
 *
 * Each workspace has its own user row, its own password hash, and its own MFA
 * setup — exactly mirroring how products like Slack handle multi-workspace
 * identity sharing without sacrificing tenant isolation.
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { listWorkspaces } from '@/lib/auth-client';
import type { WorkspaceInfo } from '@/lib/auth-client';

/**
 * Drives the workspace re-authentication flow:
 *  - clears the current dashboard session via the library's logout endpoint
 *  - then navigates to the login page of the destination tenant
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
   * Selecting the current workspace is a no-op (closes the dropdown). Selecting
   * any other workspace triggers the logout-and-redirect flow so the user can
   * re-authenticate into that tenant's distinct account.
   *
   * @param workspace - The chosen workspace.
   */
  const handleSelect = (workspace: WorkspaceInfo) => {
    if (workspace.isCurrent || isSwitching) return;
    setIsSwitching(true);
    void signOutAndGoToLogin(workspace.tenantSlug).catch(() => {
      toast.error('Could not switch workspace. Please try again.');
      setIsSwitching(false);
      router.refresh();
    });
  };

  const activeWorkspace = workspaces.find((w) => w.isCurrent) ?? workspaces[0];

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

        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.tenantId}
            onClick={() => handleSelect(workspace)}
            className={
              workspace.isCurrent
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
            {workspace.isCurrent && <span className="ml-auto text-[10px] text-[#ff6224]">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
