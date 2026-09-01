/**
 * @file user-status-cache-key.ts
 * @description Builds the library's `UserStatusGuard` cache key.
 *
 * The library caches a user's status for the guard's TTL and offers no
 * invalidation API, so status changes have to delete the key directly to make
 * a suspension bite before the TTL expires. That means reproducing a key
 * format the library owns — which is exactly why it lives in one place here
 * rather than being spelled out at each call site: the format is private and
 * version-dependent (it gained the tenant segment in lib v1.3.2), so when it
 * changes again there is a single line to update instead of a silent no-op
 * delete in every service that suspends a user.
 *
 * **Known trade-off.** AGENTS.md rule 9 gives the library the whole
 * `<namespace>:*` prefix, and this file writes into it. That is deliberate but
 * not free: the format is the library's private business and it already moved
 * once (v1.3.2 added the tenant segment). If it moves again, the delete
 * silently stops matching — a suspension would then take effect only when the
 * entry expires, with nothing failing loudly to say so.
 *
 * The alternative is to drop the invalidation and accept up to the full TTL of
 * stale enforcement after every suspension, which is worse. The real fix is a
 * supported invalidation method on the library: `UserStatusGuard` exposes only
 * `canActivate`, `AuthRedisService` exposes only generic `get`/`set`/`del`, and
 * `invalidateUserSessions` clears refresh sessions rather than this cache, so
 * there is nothing to call today. Tracked upstream as bymaxone/nest-auth#182.
 *
 * **The reproduction is partial, deliberately.** The guard caches two entries
 * per user on the same miss and TTL: `us:` for the status and `uev:` for the
 * email-verified flag. Only `us:` is deleted here, because only the status is
 * what a suspension changes. Anything that made `emailVerified` go stale would
 * need the sibling key too — a second reason this belongs upstream rather than
 * here.
 *
 * @layer redis
 * @see docs/guidelines/redis-guidelines.md
 */

/**
 * Composes the tenant-scoped status-cache key for one user.
 *
 * @param namespace - The configured `REDIS_NAMESPACE`; the library prefixes
 *   every key it owns with it, so a shared Redis instance keeps deployments
 *   apart.
 * @param tenantId - Tenant the target user belongs to.
 * @param userId - Target user's internal ID.
 * @returns The fully-qualified key the guard reads.
 */
export function userStatusCacheKey(namespace: string, tenantId: string, userId: string): string {
  return `${namespace}:us:${encodeURIComponent(tenantId)}:${encodeURIComponent(userId)}`;
}
