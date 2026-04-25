/**
 * @fileoverview Invitations table — lists pending invitations with a revoke button.
 *
 * Fetches from `GET /api/invitations` on mount and after every revoke/refresh.
 * The table is controlled by an external `refreshKey` prop so the parent
 * (`InvitePage`) can trigger a reload after a new invitation is sent.
 *
 * @layer components/dashboard
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Trash2 } from 'lucide-react';
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
import { listInvitations, revokeInvitation, handleAuthClientError } from '@/lib/auth-client';
import type { InvitationInfo } from '@/lib/auth-client';

interface InvitationsTableProps {
  /** Incrementing this value triggers a data reload. */
  refreshKey: number;
}

/**
 * Table listing all pending invitations for the current tenant.
 *
 * @param refreshKey - Increment to force a reload.
 */
export function InvitationsTable({ refreshKey }: InvitationsTableProps) {
  const [invitations, setInvitations] = useState<InvitationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listInvitations();
      setInvitations(data);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleRevoke = async (id: string, email: string) => {
    setRevoking(id);
    try {
      await revokeInvitation(id);
      toast.success(`Invitation to ${email} revoked.`);
      await load();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setRevoking(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading invitations…</p>;
  }

  if (invitations.length === 0) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">No pending invitations.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Email</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead>Sent</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {invitations.map((invite) => (
          <TableRow key={invite.id}>
            <TableCell className="text-sm text-[rgba(255,255,255,0.8)]">{invite.email}</TableCell>
            <TableCell>
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-[#ff6224]">
                {invite.role}
              </span>
            </TableCell>
            <TableCell className="text-xs">
              {formatDistanceToNow(new Date(invite.expiresAt), { addSuffix: true })}
            </TableCell>
            <TableCell className="text-xs">
              {formatDistanceToNow(new Date(invite.createdAt), { addSuffix: true })}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Revoke invitation to ${invite.email}`}
                disabled={revoking === invite.id}
                onClick={() => void handleRevoke(invite.id, invite.email)}
                className="h-7 w-7 text-[rgba(255,255,255,0.3)] hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
