/**
 * @fileoverview Tenant-resource slice of the typed API client.
 *
 * Everything the dashboard reads or writes that is scoped to a tenant rather
 * than to the signed-in credential: the tenant/workspace list and switch, the
 * member roster, projects, and invitations.
 *
 * Split out of `auth-client.ts` to keep the parent module under the 800-line
 * file cap; consumers keep importing from `@/lib/auth-client` thanks to the
 * barrel re-export there.
 *
 * @module lib/auth-client.tenants
 */

import { apiFetch } from './auth-client';

// ── Tenant types ──────────────────────────────────────────────────────────────

/**
 * Tenant as returned by `GET /api/tenants/me`.
 */
export interface TenantInfo {
  /** Unique tenant identifier (cuid). */
  id: string;
  /** Human-readable tenant name. */
  name: string;
  /** URL-safe tenant slug. */
  slug: string;
}

/**
 * Workspace as returned by `GET /api/account/workspaces` — one entry per tenant
 * where the signed-in user's email has an active account.
 *
 * The library uses a one-JWT-per-tenant model, so each workspace is backed by
 * a separate `User` row sharing the same email. Switching workspaces in the UI
 * means signing out and signing back in to the destination tenant.
 */
export interface WorkspaceInfo {
  /** Tenant CUID — used as the `X-Tenant-Id` header value after re-auth. */
  tenantId: string;
  /** URL-safe slug — used as the `?tenantId=` query param on the login page. */
  tenantSlug: string;
  /** Human-readable tenant name — what the user sees in the dropdown. */
  tenantName: string;
  /** Role granted to the user in this workspace (purely informational). */
  role: string;
  /** True when this workspace matches the current JWT's tenant context. */
  isCurrent: boolean;
}

// ── Project types ─────────────────────────────────────────────────────────────

/**
 * Project as returned by `GET /api/projects` and `POST /api/projects`.
 */
export interface ProjectInfo {
  /** Unique project identifier (cuid). */
  id: string;
  /** Project name. */
  name: string;
  /** Tenant the project belongs to. */
  tenantId: string;
  /** User ID of the project owner. */
  ownerUserId: string;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-updated timestamp. */
  updatedAt: string;
}

// ── User types ────────────────────────────────────────────────────────────────

/**
 * Tenant user as returned by `GET /api/users` and `PATCH /api/users/:id/status`.
 */
export interface TenantUserInfo {
  /** Unique user identifier (cuid). */
  id: string;
  /** User's primary email address. */
  email: string;
  /** User's display name. */
  name: string;
  /** Authorization role within the tenant. */
  role: string;
  /** Account lifecycle status. */
  status: string;
  /** Whether TOTP MFA is enabled on the account. */
  mfaEnabled: boolean;
  /** Tenant the user belongs to. */
  tenantId: string;
  /** Whether the user's email address has been verified. */
  emailVerified: boolean;
  /** ISO 8601 timestamp of the most recent login. */
  lastLoginAt: string | null;
  /** ISO 8601 account creation timestamp. */
  createdAt: string;
}

// ── Invitation types ──────────────────────────────────────────────────────────

/**
 * Invitation record as returned by `GET /api/invitations`.
 */
export interface InvitationInfo {
  /** Unique invitation identifier (cuid). */
  id: string;
  /** Email address of the invitee. */
  email: string;
  /** Role the invitee will receive on acceptance. */
  role: string;
  /** Tenant the invitation belongs to. */
  tenantId: string;
  /** ISO 8601 expiry timestamp. */
  expiresAt: string;
  /** ISO 8601 acceptance timestamp, or `null` when still pending. */
  acceptedAt: string | null;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

// ── Tenant helpers ────────────────────────────────────────────────────────────

/**
 * Lists all tenants the authenticated user belongs to.
 *
 * @returns Array of `TenantInfo` objects.
 */
export const listTenants = (): Promise<TenantInfo[]> => apiFetch<TenantInfo[]>('/tenants/me');

/**
 * Lists every workspace (tenant) the authenticated user's email has an active
 * account in — the data source for the dashboard's workspace switcher.
 *
 * @returns Array of `WorkspaceInfo` with the current workspace first.
 */
export const listWorkspaces = (): Promise<WorkspaceInfo[]> =>
  apiFetch<WorkspaceInfo[]>('/account/workspaces');

/**
 * Result body returned by `POST /api/account/switch-workspace` on success.
 *
 * The example uses cookie-mode `tokenDelivery`, so the access + refresh
 * tokens travel via `Set-Cookie` headers — the JSON body carries only the
 * `user` projection. Mirrors the lib's `CookieAuthResponse` shape.
 *
 * @public
 */
export interface SwitchWorkspaceResult {
  /** The signed-in user in the destination tenant. */
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    status: string;
    tenantId: string;
    emailVerified: boolean;
    mfaEnabled: boolean;
  };
}

/**
 * Silently switches the current session to a sibling `User` row in another
 * tenant (Slack-style multi-workspace identity sharing) — no password
 * re-entry required.
 *
 * Backed by `POST /api/account/switch-workspace` which:
 *   1. Validates the caller's email has an ACTIVE row in `tenantId`.
 *   2. Calls the lib's `AuthService.issueTokensForUserId` (v1.0.10+) to
 *      mint a fresh session for that target row.
 *   3. Writes the access / refresh / has-session cookies via the lib's
 *      `TokenDeliveryService.deliverAuthResponse`.
 *
 * After this call the browser's cookies belong to the destination tenant.
 * Callers must trigger a session reload (`useSession().refresh()` plus a
 * `router.refresh()`) so React state mirrors the new identity. The
 * `TenantSwitcher` component handles that wiring; consumers calling this
 * directly are responsible.
 *
 * MFA-enabled destination accounts are rejected by the lib with
 * `MFA_REQUIRED` (HTTP 401, `code: 'auth.mfa_required'`). The caller
 * should catch that and redirect the user to
 * `/auth/login?tenantId=<slug>` so the destination tenant's MFA
 * challenge runs through the canonical login flow.
 *
 * @param tenantId - Destination tenant CUID (from `WorkspaceInfo.tenantId`).
 * @returns The destination tenant's user projection.
 * @throws `AuthClientError` with code:
 *   - `auth.mfa_required` when the destination has MFA — redirect to login.
 *   - `auth.account_suspended` / `auth.account_banned` / `auth.account_inactive`
 *     when the destination row is blocked.
 *   - HTTP 404 when the caller has no row in the destination tenant.
 *   - HTTP 400 when the destination equals the current tenant.
 */
export const switchWorkspace = (tenantId: string): Promise<SwitchWorkspaceResult> =>
  apiFetch<SwitchWorkspaceResult>('/account/switch-workspace', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });

// ── User helpers ──────────────────────────────────────────────────────────────

/**
 * Lists all users in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @returns Array of `TenantUserInfo` objects.
 */
export const listUsers = (): Promise<TenantUserInfo[]> => apiFetch<TenantUserInfo[]>('/users');

/**
 * Updates a user's account status.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param id     - Target user ID.
 * @param status - New account status (`'ACTIVE'`, `'SUSPENDED'`, etc.).
 * @returns The updated `TenantUserInfo`.
 */
export const updateUserStatus = (id: string, status: string): Promise<TenantUserInfo> =>
  apiFetch<TenantUserInfo>(`/users/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

// ── Project helpers ───────────────────────────────────────────────────────────

/**
 * Lists all projects in the current tenant.
 *
 * @returns Array of `ProjectInfo` objects sorted newest-first.
 */
export const listProjects = (): Promise<ProjectInfo[]> => apiFetch<ProjectInfo[]>('/projects');

/**
 * Creates a new project in the current tenant.
 *
 * Admin-only; requires the `ADMIN` (or higher) role in the JWT.
 *
 * @param name - Human-readable project name.
 * @returns The newly created `ProjectInfo`.
 */
export const createProject = (name: string): Promise<ProjectInfo> =>
  apiFetch<ProjectInfo>('/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

/**
 * Deletes a project by ID.
 *
 * Admin-only; tenant isolation is enforced server-side.
 *
 * @param id - Project ID to delete.
 */
export const deleteProject = (id: string): Promise<void> =>
  apiFetch<void>(`/projects/${id}`, { method: 'DELETE' });

// ── Invitation helpers ────────────────────────────────────────────────────────

/**
 * Lists all invitations (pending and accepted) for the current tenant.
 *
 * Admin-only; backed by the custom `GET /api/invitations` endpoint.
 *
 * @returns Array of `InvitationInfo` objects sorted newest-first.
 */
export const listInvitations = (): Promise<InvitationInfo[]> =>
  apiFetch<InvitationInfo[]>('/invitations');

/**
 * Creates an invitation for a new user to join the current tenant.
 *
 * Calls the library's `POST /api/auth/invitations` endpoint. The `tenantId`
 * is extracted from the caller's JWT on the server side — it is never passed
 * in the body to prevent tenant spoofing.
 *
 * @param email - Invitee's email address.
 * @param role  - Role the invitee will receive on acceptance.
 */
export const createInvitation = (email: string, role: string): Promise<void> =>
  // POST to the app-side controller (`/api/invitations`) so the row is
  // persisted in the same Prisma table the dashboard reads from. The lib's
  // `/api/auth/invitations` endpoint stores in Redis only; using that here
  // would silently send the email but never surface the invitation in the UI.
  apiFetch<void>('/invitations', {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });

/**
 * Revokes (deletes) an invitation by ID.
 *
 * Backed by the custom `DELETE /api/invitations/:id` endpoint.
 *
 * @param id - Invitation ID to delete.
 */
export const revokeInvitation = (id: string): Promise<void> =>
  apiFetch<void>(`/invitations/${id}`, { method: 'DELETE' });

// ── Topic-module re-exports ───────────────────────────────────────────────────
