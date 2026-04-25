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
  INACTIVE:
    'border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]',
  SUSPENDED: 'border-[rgba(234,179,8,0.3)] bg-[rgba(234,179,8,0.1)] text-[#eab308]',
  BANNED: 'border-[rgba(239,68,68,0.3)] bg-[rgba(239,68,68,0.1)] text-[#ef4444]',
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
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

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
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleStatus = async (user: TenantUserInfo) => {
    const nextStatus = user.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    setToggling(user.id);
    try {
      await updateUserStatus(user.id, nextStatus);
      toast.success(`User ${nextStatus === 'ACTIVE' ? 'unsuspended' : 'suspended'}.`);
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
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={toggling === user.id}
                      onClick={() => void handleToggleStatus(user)}
                      className="h-6 px-2 text-[10px] text-[rgba(255,255,255,0.4)] hover:text-white"
                    >
                      {user.status === 'ACTIVE' ? 'Suspend' : 'Unsuspend'}
                    </Button>
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
