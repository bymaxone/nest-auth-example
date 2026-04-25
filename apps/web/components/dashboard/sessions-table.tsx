/**
 * @fileoverview Sessions table — lists active sessions with a per-row revoke button.
 *
 * Fetches sessions from `GET /auth/sessions` on mount and after each revoke.
 * The current session is identified by `isCurrent: true` — its revoke button
 * is disabled (the user should use "Sign out" instead).
 *
 * @layer components/dashboard
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Monitor, Trash2 } from 'lucide-react';
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
import { listSessions, revokeSession, handleAuthClientError } from '@/lib/auth-client';
import type { SessionInfo } from '@/lib/auth-client';

/**
 * Table listing every active session for the signed-in user.
 *
 * Disables the revoke button for the current session and shows a "Current"
 * badge instead.
 */
export function SessionsTable() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (sessionHash: string) => {
    setRevoking(sessionHash);
    try {
      await revokeSession(sessionHash);
      toast.success('Session revoked.');
      await load();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setRevoking(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading sessions…</p>;
  }

  if (sessions.length === 0) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">No active sessions found.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Device</TableHead>
          <TableHead>IP address</TableHead>
          <TableHead>Last active</TableHead>
          <TableHead>Started</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((session) => (
          <TableRow key={session.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                <Monitor className="h-3.5 w-3.5 shrink-0 text-[rgba(255,255,255,0.3)]" />
                <span className="max-w-[180px] truncate text-xs text-[rgba(255,255,255,0.7)]">
                  {session.device ?? 'Unknown device'}
                </span>
                {session.isCurrent && (
                  <span className="rounded-full border border-[rgba(255,98,36,0.3)] bg-[rgba(255,98,36,0.1)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#ff6224]">
                    Current
                  </span>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-xs">{session.ip ?? '—'}</TableCell>
            <TableCell className="text-xs">
              {formatDistanceToNow(new Date(session.lastActivityAt), { addSuffix: true })}
            </TableCell>
            <TableCell className="text-xs">
              {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
            </TableCell>
            <TableCell>
              {!session.isCurrent && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Revoke session"
                  disabled={revoking === session.sessionHash}
                  onClick={() => void handleRevoke(session.sessionHash)}
                  className="h-7 w-7 text-[rgba(255,255,255,0.3)] hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
