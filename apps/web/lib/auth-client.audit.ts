/**
 * @fileoverview Audit-log slice of the typed API client.
 *
 * One read-only endpoint that surfaces the rows the app's `AppAuthHooks`
 * writes to the `AuditLog` Prisma table. Split out of `auth-client.ts`
 * to keep the parent module under the 800-line file cap; consumers keep
 * importing from `@/lib/auth-client` thanks to the barrel re-export
 * there.
 *
 * @module lib/auth-client.audit
 */

import { apiFetch } from './auth-client';

/**
 * One row exposed by `GET /api/audit`. Mirrors `AuditEntry` from the API.
 *
 * The `payload` field is opaque JSON whose shape varies per event slug —
 * the UI renders it as pretty-printed JSON rather than typing each variant.
 *
 * @public
 */
export interface AuditEntryInfo {
  /** Row identifier (cuid). */
  id: string;
  /** Event slug, e.g. `user.login.succeeded`. */
  event: string;
  /** Actor user id, or `null` for system-initiated events. */
  actorUserId: string | null;
  /** Structured event payload — opaque JSON written by the hook. */
  payload: unknown;
  /** Source IP recorded by the hook. */
  ip: string | null;
  /** User-Agent recorded by the hook. */
  userAgent: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/**
 * Fetches up to 100 most recent audit entries for the current tenant.
 *
 * Admin-gated server-side via `@Roles('ADMIN')` — non-admins receive a
 * 403 (the lib's `RolesGuard` rejects). The client surfaces that as a
 * "forbidden" toast through `handleAuthClientError`.
 *
 * @returns Audit entries newest first.
 */
export const listAuditEntries = (): Promise<AuditEntryInfo[]> =>
  apiFetch<AuditEntryInfo[]>('/audit');
