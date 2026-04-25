/**
 * @file auth.constants.ts
 * @description Shared auth-layer constants used across multiple files in the
 * `src/auth` module. This is the **single source of truth** for blocked statuses:
 * `auth.config.ts`, `AppAuthHooks.onOAuthLogin`, and `PrismaUserRepository`
 * all import from here to ensure the credential path and the OAuth path always
 * enforce the same set.
 *
 * @layer auth
 */

import { UserStatus } from '@prisma/client';

/**
 * User statuses that must never receive auth tokens.
 *
 * Typed as `readonly UserStatus[]` so that a misspelled status or a schema
 * removal causes a compile error rather than a silent security regression.
 *
 * Imported by `auth.config.ts` as `blockedStatuses` (credential login path),
 * by `AppAuthHooks.onOAuthLogin` (already-linked OAuth accounts), and by
 * `PrismaUserRepository.createWithOAuth` (first-time OAuth sign-in).
 * Adding a new blocked status here automatically propagates to all three paths.
 */
export const BLOCKED_USER_STATUSES: readonly UserStatus[] = [
  UserStatus.BANNED,
  UserStatus.INACTIVE,
  UserStatus.SUSPENDED,
];

/**
 * Returns true when the given status string matches a blocked status.
 *
 * The library types `SafeAuthUser.status` as `string` (not `UserStatus`) so
 * callers that hold a library user object cannot use `BLOCKED_USER_STATUSES.includes`
 * directly — TypeScript rejects passing `string` where `UserStatus` is expected.
 * This helper accepts `string` and performs the safe widened lookup internally,
 * keeping the constant itself strictly typed.
 *
 * @param status - Any status string from a library-returned user object.
 */
export function isBlockedStatus(status: string): boolean {
  return (BLOCKED_USER_STATUSES as readonly string[]).includes(status);
}
