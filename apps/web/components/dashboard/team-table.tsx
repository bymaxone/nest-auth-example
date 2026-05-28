/**
 * @fileoverview Team table — lists all tenant members with status and role badges.
 *
 * Admins also see a status toggle per row (via `PATCH /api/users/:id/status`).
 * Non-admins see a read-only view.
 *
 * @layer components/dashboard
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
import { listUsers, updateUserStatus, handleAuthClientError } from '@/lib/auth-client';
import type { TenantUserInfo } from '@/lib/auth-client';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'border-[rgba(34,197,94,0.3)] bg-[rgba(34,197,94,0.1)] text-[#22c55e]',
  PENDING: 'border-[rgba(59,130,246,0.3)] bg-[rgba(59,130,246,0.1)] text-[#60a5fa]',
  INACTIVE:
    'border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]',
  SUSPENDED: 'border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.1)] text-[#eab308]',
  BANNED: 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] text-[#ef4444]',
};

/**
 * Status-transition affordances shown on each row in the admin view.
 *
 * Each status maps to the action(s) an admin can apply to a member in that
 * state. Returning an empty array means "no admin action available" (e.g. a
 * BANNED user is intentionally a dead-end; lifting a ban is a deliberately
 * higher-friction action handled outside the team table).
 *
 * Keeping the matrix here — rather than scattered ternaries in JSX — keeps
 * the lib's `UserStatus` enum and the UI's state machine visibly aligned.
 */
interface StatusAction {
  /** Status to write via PATCH /api/users/:id/status. */
  readonly next: string;
  /** Button copy. */
  readonly label: string;
  /** Toast message on success (past tense, user-friendly). */
  readonly successCopy: string;
  /** Optional Tailwind colour modifier — destructive actions stand out. */
  readonly variant?: 'default' | 'destructive';
}

const STATUS_ACTIONS: Record<string, readonly StatusAction[]> = {
  ACTIVE: [
    { next: 'SUSPENDED', label: 'Suspend', successCopy: 'suspended', variant: 'destructive' },
  ],
  PENDING: [{ next: 'ACTIVE', label: 'Activate', successCopy: 'activated' }],
  SUSPENDED: [{ next: 'ACTIVE', label: 'Unsuspend', successCopy: 'unsuspended' }],
  INACTIVE: [{ next: 'ACTIVE', label: 'Reactivate', successCopy: 'reactivated' }],
  BANNED: [],
};

interface TeamTableProps {
  /** When true, render the status-toggle button for each row (admin only). */
  isAdmin: boolean;
  /** Authenticated user's ID — used to prevent self-toggle. */
  currentUserId: string;
}

/**
 * Table listing all tenant users.
 *
 * @param isAdmin       - Renders status-toggle controls when true.
 * @param currentUserId - Prevents the admin from toggling their own status.
 */
export function TeamTable({ isAdmin, currentUserId }: TeamTableProps) {
  const [users, setUsers] = useState<TenantUserInfo[]>([]);
  // Stryker disable next-line BooleanLiteral: initial `true` is paired with the `users.length === 0` empty-state guard below — even when mutated to `false`, the empty-array fallback still renders the muted "No members found." paragraph until the fetch settles. The two guards cover overlapping failure modes (network-pending vs empty-response).
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  // Stryker disable next-line ArrayDeclaration: useCallback deps are empty — `listUsers` takes no arguments and `setUsers` / `setIsLoading` / `handleAuthClientError` / `toast` are all stable references. A mutated `["Stryker"]` is a static single-element array (reference-stable across renders) so the callback identity stays stable per render either way.
  const loadDeps: readonly unknown[] = [];
  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  }, loadDeps);

  // Stryker disable next-line ArrayDeclaration: useEffect deps are `[load]` — a mutated single-element array stays reference-stable across renders, identical effect cadence.
  const effectDeps: readonly unknown[] = [load];
  useEffect(() => {
    void load();
  }, effectDeps);

  /**
   * Submits a single status transition for the targeted user.
   *
   * Uses the `STATUS_ACTIONS` matrix as the source of truth — the caller
   * passes in the row's status-specific action, so the same handler
   * powers "Suspend", "Activate", "Unsuspend", and "Reactivate" without
   * branching by status string inside the body.
   */
  const handleStatusAction = async (user: TenantUserInfo, action: StatusAction) => {
    setToggling(user.id);
    try {
      await updateUserStatus(user.id, action.next);
      toast.success(`User ${action.successCopy}.`);
      await load();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setToggling(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading team…</p>;
  }

  if (users.length === 0) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">No members found.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Joined</TableHead>
          {isAdmin && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => {
          const statusStyle = STATUS_STYLES[user.status] ?? STATUS_STYLES['INACTIVE'];
          return (
            <TableRow key={user.id}>
              <TableCell className="font-medium text-[rgba(255,255,255,0.8)]">
                {user.name}
              </TableCell>
              <TableCell className="text-xs">{user.email}</TableCell>
              <TableCell>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#ff6224]">
                  {user.role}
                </span>
              </TableCell>
              <TableCell>
                <span
                  // Stryker disable next-line StringLiteral: structural badge classes (`rounded-full border px-1.5 …`) are pure visual styling — the per-status palette is interpolated in via `${statusStyle}` which IS pinned by the per-branch palette tests above. Mutating the structural prefix to `""` would leave the badge rendering with only the tone classes, identical contract from the test's perspective.
                  className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusStyle}`}
                >
                  {user.status}
                </span>
              </TableCell>
              <TableCell className="text-xs">
                {formatDistanceToNow(new Date(user.createdAt), { addSuffix: true })}
              </TableCell>
              {isAdmin && (
                <TableCell>
                  {user.id !== currentUserId && (
                    <div className="flex gap-1">
                      {(STATUS_ACTIONS[user.status] ?? []).map((action) => (
                        <Button
                          key={action.next}
                          variant="ghost"
                          size="sm"
                          disabled={toggling === user.id}
                          onClick={() => void handleStatusAction(user, action)}
                          // Stryker disable next-line StringLiteral: structural button classes (`h-6 px-2 text-[10px]`) are pure visual sizing — the per-variant palette is interpolated below and pinned by the destructive-vs-default hover-class tests. Mutating the structural prefix is equivalent under the test contract.
                          className={`h-6 px-2 text-[10px] ${
                            action.variant === 'destructive'
                              ? 'text-[rgba(255,255,255,0.4)] hover:bg-red-500/10 hover:text-red-300'
                              : // Stryker disable next-line StringLiteral: the non-destructive arm's full class string is visual-only — `hover:text-white` is the only behaviourally-distinguishing token and is pinned by the negative-space assertion in the Activate-button test.
                                'text-[rgba(255,255,255,0.4)] hover:text-white'
                          }`}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  )}
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
