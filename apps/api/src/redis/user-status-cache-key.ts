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
