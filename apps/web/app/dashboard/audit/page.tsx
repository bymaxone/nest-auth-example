/**
 * @fileoverview Audit log viewer page — admin-only timeline of every
 * tenant-scoped event the lib's `IAuthHooks` lifecycle has recorded.
 *
 * Sources rows from `GET /api/audit` (max 100, newest first). The endpoint
 * is role-gated server-side via `@Roles('ADMIN')`; the sidebar entry is
 * gated client-side by the same role, but a member who deep-links here
 * will see a "forbidden" toast and an empty table — the API is the
 * source of truth.
 *
 * Renders each event with a colour-tinted pill (slug-prefix-derived) so
 * the operator can scan a long table without reading every row. Payload
 * detail surfaces in a per-row `<details>` element to keep the default
 * scroll cheap.
 *
 * @layer pages/dashboard
 */

'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ScrollText } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listAuditEntries, handleAuthClientError, type AuditEntryInfo } from '@/lib/auth-client';

/**
 * Colour ramp by event slug prefix. Keeps the visual taxonomy lightweight
 * — admins glance at the table and immediately see clusters of logins,
 * MFA changes, password resets, and session events.
 */
const PREFIX_STYLES: ReadonlyArray<{ readonly prefix: string; readonly className: string }> = [
  {
    prefix: 'user.login.failed',
    className: 'border-red-500/30 bg-red-500/10 text-red-300',
  },
  {
    prefix: 'user.login',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  {
    prefix: 'user.logout',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  {
    prefix: 'user.register',
    className: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
  {
    prefix: 'mfa',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  },
  {
    prefix: 'password',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  {
    prefix: 'session',
    className: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  },
  {
    prefix: 'invitation',
    className: 'border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300',
  },
  {
    prefix: 'email',
    className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  },
];

const DEFAULT_PILL_STYLE =
  'border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.6)]';

/**
 * Returns the Tailwind class string for an event-slug pill. Falls back
 * to a neutral grey when no prefix matches — so a future event slug
 * still renders cleanly without code changes.
 */
function pillStyleForEvent(event: string): string {
  const match = PREFIX_STYLES.find((entry) => event.startsWith(entry.prefix));
  return match?.className ?? DEFAULT_PILL_STYLE;
}

/**
 * Audit log page — admin-gated, read-only.
 */
export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntryInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await listAuditEntries();
        if (!cancelled) setEntries(data);
      } catch (err) {
        if (!cancelled) handleAuthClientError(err, { toast });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div>
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-[#ff6224]" />
          <h1 className="font-mono text-2xl font-bold text-white">Audit log</h1>
        </div>
        <p className="mt-1 text-sm text-[rgba(255,255,255,0.5)]">
          The 100 most recent events recorded by the auth lifecycle hooks for this workspace. Rows
          are written automatically by{' '}
          <code className="rounded bg-[rgba(255,255,255,0.05)] px-1 text-xs">AppAuthHooks</code> —
          this table is read-only.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading events…</p>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-6">
          <p className="text-sm text-[rgba(255,255,255,0.5)]">
            No audit events recorded yet. Sign in, change a password, enable MFA, or invite a
            teammate to populate this table.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-xs text-[rgba(255,255,255,0.6)]">
                  {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${pillStyleForEvent(row.event)}`}
                  >
                    {row.event}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-[10px] text-[rgba(255,255,255,0.5)]">
                  {row.actorUserId ?? 'system'}
                </TableCell>
                <TableCell className="font-mono text-[10px] text-[rgba(255,255,255,0.5)]">
                  {row.ip ?? '—'}
                </TableCell>
                <TableCell>
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-[rgba(255,255,255,0.4)] hover:text-white">
                      payload
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-[rgba(0,0,0,0.4)] p-2 font-mono text-[10px] text-[rgba(255,255,255,0.7)]">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </details>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
