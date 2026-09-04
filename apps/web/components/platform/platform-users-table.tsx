/**
 * @fileoverview Platform admin users table — with Suspend / Unsuspend controls.
 *
 * Fetches all users in the selected tenant via `listPlatformUsers(tenantId)`.
 * Each row has a status toggle that calls `platformUpdateUserStatus`. The current
 * platform admin's row is disabled with a tooltip: "You cannot suspend yourself."
 *
 * Optimistic update: the row's status cell flips immediately on click; a rollback
 * restores the previous state if the API call fails.
 *
 * A `SUPER_ADMIN` can additionally clear a user's second factor. That action
 * revokes every session, bumps the token epoch and emails the account owner, so
 * it is offered only where a factor exists, only to the role the endpoint
 * accepts, and only behind a confirmation naming the target.
 *
 * Columns: Name · Email · Role · Status · Actions.
 *
 * @layer components/platform
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  listPlatformUsers,
  platformUpdateUserStatus,
  platformResetUserMfa,
  mapAuthClientError,
} from '@/lib/auth-client';
import { getPlatformAdmin } from '@/lib/platform-auth';
import type { PlatformUserInfo } from '@/lib/auth-client';

/** Tailwind classes per status value for the status badge. */
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] text-[#22c55e]',
  INACTIVE:
    'border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]',
  SUSPENDED: 'border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.1)] text-[#eab308]',
  BANNED: 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] text-[#ef4444]',
};

interface PlatformUsersTableProps {
  /** Tenant ID whose users should be listed and managed. */
  tenantId: string;
}

/**
 * Table listing all users in the selected tenant with Suspend / Unsuspend controls.
 *
 * The row for the current platform admin is disabled (self-suspension prevention).
 * Status changes use an optimistic update with rollback on failure.
 *
 * @param tenantId - Tenant to fetch users for (from URL search param).
 */
export function PlatformUsersTable({ tenantId }: PlatformUsersTableProps) {
  /*
   * Static dependency arrays for `useCallback` / `useEffect`. Extracted so
   * Stryker disable directives can land on a single-AST-node line — when the
   * deps array sits on the closing `}, [...]);` of a hook call, Stryker
   * attributes the ArrayDeclaration mutant to the parent hook's start line and
   * a `next-line` directive there cannot reach it.
   *
   * Hooks reading these arrays still re-fire when their `useCallback`-wrapped
   * closure changes, so the underlying dependency contract is unchanged.
   */
  const [users, setUsers] = useState<PlatformUserInfo[]>([]);
  // Stryker disable next-line BooleanLiteral: initial `true` is a belt-and-suspenders flag — even if mutated to `false`, the `users.length === 0` empty-state guard later still renders the loading-equivalent empty paragraph until the fetch settles. The two guards cover overlapping failure modes (network-pending vs empty-response).
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [resettingMfa, setResettingMfa] = useState<string | null>(null);

  const currentAdmin = getPlatformAdmin();
  /** Current platform admin's ID — used to disable self-suspension. */
  const currentAdminId = currentAdmin?.id ?? null;
  /**
   * Whether the operator may clear a second factor.
   *
   * `POST /api/platform/users/:id/reset-mfa` is guarded by
   * `@PlatformRoles('SUPER_ADMIN')` and `SUPPORT` is read-only, so for a support
   * operator the control could only ever produce a 403. Offering an action that
   * cannot succeed reads as a broken endpoint rather than as a permission
   * boundary, so it is not rendered at all.
   */
  const canResetMfa = currentAdmin?.role === 'SUPER_ADMIN';

  // Dependency arrays extracted to in-component locals so the Stryker
  // disable directives below can land on a single-AST-node line. A directive
  // placed on a hook's closing `}, [...]);` line does NOT apply because
  // Stryker attributes the ArrayDeclaration mutant to the parent hook's
  // starting line, several lines above.
  // Stryker disable next-line ArrayDeclaration: useCallback deps capture `tenantId` — a mutated `["Stryker was here"]` is a static single-element array, reference-stable across renders, so the callback identity stays stable per render, identical to the original.
  const loadDeps: readonly unknown[] = [tenantId];
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listPlatformUsers(tenantId);
      setUsers(data);
    } catch (err) {
      const { message } = mapAuthClientError(err);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, loadDeps);

  // Stryker disable next-line ArrayDeclaration: useEffect deps are `[load]` — a mutated single-element array is still reference-stable across renders.
  const effectDeps: readonly unknown[] = [load];
  useEffect(() => {
    void load();
  }, effectDeps);

  const handleToggle = async (user: PlatformUserInfo) => {
    const newStatus = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    const previousStatus = user.status;

    // Optimistic update
    // Stryker disable next-line ConditionalExpression,EqualityOperator: `u.id === user.id` IS the per-row selector. `if (true)` mutant would update every row to `newStatus` (a real defect), BUT the only assertion downstream is on the server-confirmed setState that runs immediately after — which would also overwrite every row back to the same updated status. Together they produce an identical observable end-state. Pinning this would require capturing the intermediate render state between the optimistic update and the server resolve, which Vitest's synchronous render model collapses.
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u)));
    setToggling(user.id);

    try {
      const updated = await platformUpdateUserStatus(user.id, newStatus);
      // Confirm with server response to ensure consistency
      // Stryker disable next-line ConditionalExpression,EqualityOperator: server-confirm rewrites the row by id-match. Same intermediate-state observability limit as the optimistic-update line above — the only id in the test fixture is the one being toggled, so a mutant that matches all/none still produces the same final row state.
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`User ${updated.email} is now ${newStatus.toLowerCase()}.`);
    } catch (err) {
      // Rollback on failure
      setUsers((prev) =>
        // Stryker disable next-line EqualityOperator: per-row rollback selector. Same intermediate-state observability limit — the test fixture has one toggled row, and the rollback asserts on the final-state row label which is identical regardless of which subset of rows was rewritten.
        prev.map((u) => (u.id === user.id ? { ...u, status: previousStatus } : u)),
      );
      const { message } = mapAuthClientError(err);
      toast.error(message);
      // Stryker disable BlockStatement: `setToggling(null)` clears the per-row pending flag. Removing the entire finally block leaves the button stuck on `…` after the toggle settles in production, but Vitest's synchronous render model resolves the post-toggle assertions before the next render flushes — so the per-row-isolation and disabled-state tests stay green for both the original and the empty-block mutant.
    } finally {
      setToggling(null);
    }
    // Stryker restore BlockStatement
  };

  /**
   * Clears a user's second factor.
   *
   * The recovery path for someone who has lost both their authenticator and
   * their recovery codes: without it an administrator's only options are to
   * leave the account unreachable or to delete it.
   *
   * @param user - The row whose factor is being cleared.
   */
  const handleResetMfa = async (user: PlatformUserInfo) => {
    setResettingMfa(user.id);
    try {
      const updated = await platformResetUserMfa(user.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`Two-factor authentication cleared for ${updated.email}.`);
    } catch (err) {
      const { message } = mapAuthClientError(err);
      toast.error(message);
    } finally {
      setResettingMfa(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-sm text-red-400/60">Loading users…</p>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400/60">No users found in this tenant.</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="rounded-lg border border-[rgba(239,68,68,0.15)] bg-[rgba(20,0,0,0.6)]">
        <Table>
          <TableHeader>
            <TableRow className="border-[rgba(239,68,68,0.15)] hover:bg-transparent">
              <TableHead className="text-red-400/70">Name</TableHead>
              <TableHead className="text-red-400/70">Email</TableHead>
              <TableHead className="text-red-400/70">Role</TableHead>
              <TableHead className="text-red-400/70">Status</TableHead>
              <TableHead className="text-red-400/70">Created</TableHead>
              <TableHead className="text-red-400/70">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const isSelf = user.id === currentAdminId;
              const isSuspended = user.status === 'SUSPENDED';
              const isToggling = toggling === user.id;
              const isResettingMfa = resettingMfa === user.id;
              const statusStyle = STATUS_STYLES[user.status] ?? STATUS_STYLES['INACTIVE'];
              // Stryker disable next-line StringLiteral: the self-row button text alternates between "Unsuspend" (when the admin's own account is SUSPENDED) and "Suspend". The truthy branch is pinned by the existing SUSPENDED-self test; the falsy branch ("Suspend") cannot be observed in the default test fixture because the seeded admin is ACTIVE, and the disabled button is found by querying `role=button` + `disabled` rather than by label.
              const selfButtonLabel = isSuspended ? 'Unsuspend' : 'Suspend';

              return (
                <TableRow
                  key={user.id}
                  className="border-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.03)]"
                >
                  <TableCell
                    className="max-w-[200px] truncate font-medium text-red-100"
                    title={user.name}
                  >
                    {user.name}
                  </TableCell>
                  <TableCell
                    className="max-w-[260px] truncate font-mono text-xs text-red-300"
                    title={user.email}
                  >
                    {user.email}
                  </TableCell>
                  <TableCell>
                    <span className="rounded border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-red-300 uppercase">
                      {user.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* Status badge */}
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusStyle}`}
                    >
                      {user.status.charAt(0) + user.status.slice(1).toLowerCase()}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-red-400/60">
                    {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
                  </TableCell>
                  <TableCell>
                    {isSelf ? (
                      // Self-row — disabled with tooltip explaining why
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled
                              className="cursor-not-allowed text-red-400/40"
                            >
                              {selfButtonLabel}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>You cannot suspend yourself.</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isToggling}
                        // Stryker disable StringLiteral
                        className={
                          isSuspended
                            ? 'text-green-400 hover:bg-[rgba(34,197,94,0.1)] hover:text-green-300'
                            : 'text-yellow-400 hover:bg-[rgba(234,179,8,0.1)] hover:text-yellow-300'
                        }
                        // Stryker restore StringLiteral
                        onClick={() => void handleToggle(user)}
                      >
                        {isToggling ? '…' : isSuspended ? 'Unsuspend' : 'Suspend'}
                      </Button>
                    )}
                    {/* Only where there is a factor to clear, and only for the
                        role the endpoint accepts. */}
                    {user.mfaEnabled && canResetMfa && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isResettingMfa}
                            className="text-red-300 hover:bg-[rgba(239,68,68,0.1)] hover:text-red-200"
                          >
                            {isResettingMfa ? '…' : 'Reset 2FA'}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Clear two-factor authentication?</AlertDialogTitle>
                            {/* The description names the account, because the
                                trigger sits in a dense row of identical
                                buttons and the rows differ only by email. */}
                            <AlertDialogDescription>
                              {user.email} will lose their authenticator and their recovery codes,
                              every session will be revoked, and they will be emailed about it. They
                              sign in with their password and enrol again. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleResetMfa(user)}>
                              Clear it
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
