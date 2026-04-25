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
 * Columns: Name · Email · Role · Status · Actions.
 *
 * FCM row #22 — Platform admin context.
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { listPlatformUsers, platformUpdateUserStatus, mapAuthClientError } from '@/lib/auth-client';
import { translateAuthError } from '@/lib/auth-errors';
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
  const [users, setUsers] = useState<PlatformUserInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  /** Current platform admin's ID — used to disable self-suspension. */
  const currentAdminId = getPlatformAdmin()?.id ?? null;

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listPlatformUsers(tenantId);
      setUsers(data);
    } catch (err) {
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggle = async (user: PlatformUserInfo) => {
    const newStatus = user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    const previousStatus = user.status;

    // Optimistic update
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u)));
    setToggling(user.id);

    try {
      const updated = await platformUpdateUserStatus(user.id, newStatus);
      // Confirm with server response to ensure consistency
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`User ${updated.email} is now ${newStatus.toLowerCase()}.`);
    } catch (err) {
      // Rollback on failure
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, status: previousStatus } : u)),
      );
      const { code } = mapAuthClientError(err);
      toast.error(translateAuthError(code === 'UNKNOWN' ? '' : code));
    } finally {
      setToggling(null);
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
              const statusStyle = STATUS_STYLES[user.status] ?? STATUS_STYLES['INACTIVE'];

              return (
                <TableRow
                  key={user.id}
                  className="border-[rgba(239,68,68,0.1)] hover:bg-[rgba(239,68,68,0.03)]"
                >
                  <TableCell className="font-medium text-red-100">{user.name}</TableCell>
                  <TableCell className="font-mono text-xs text-red-300">{user.email}</TableCell>
                  <TableCell>
                    <span className="rounded border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.08)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-red-300">
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
                              {isSuspended ? 'Unsuspend' : 'Suspend'}
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
                        className={
                          isSuspended
                            ? 'text-green-400 hover:bg-[rgba(34,197,94,0.1)] hover:text-green-300'
                            : 'text-yellow-400 hover:bg-[rgba(234,179,8,0.1)] hover:text-yellow-300'
                        }
                        onClick={() => void handleToggle(user)}
                      >
                        {isToggling ? '…' : isSuspended ? 'Unsuspend' : 'Suspend'}
                      </Button>
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
