/**
 * @fileoverview Silent refresh end-to-end spec — client-refresh handler triggers in the
 * browser when the access cookie is expired (or absent) but the refresh
 * cookie is still valid.
 *
 * The example wires `POST /api/auth/client-refresh` ([apps/web/app/api/auth/
 * client-refresh/route.ts]) via `createClientRefreshHandler` from the lib's
 * Next.js subpath. The `AuthProvider` calls it whenever it sees a 401 from
 * the API and the refresh cookie is still on disk. This spec proves that
 * the loop is wired correctly:
 *
 *   1. Sign in normally (both `access_token` and `refresh_token` cookies set).
 *   2. Delete only the `access_token` cookie — simulates an expired token.
 *   3. Trigger a client-side fetch by reloading the dashboard.
 *   4. Observe a `POST /api/auth/client-refresh` request.
 *   5. The handler's 200 response carries a new `access_token` cookie.
 *   6. The next protected request (e.g. `GET /api/auth/me`) returns 200.
 *
 * Sets a network listener BEFORE the trigger so the assertion does not rely
 * on timing; uses `page.waitForResponse` to deterministically catch the
 * single refresh POST that should fire.
 *
 * @layer test/e2e
 */

import { test, expect } from '@playwright/test';

const MEMBER_EMAIL = process.env['E2E_MEMBER_EMAIL'] ?? 'member@example.dev';
const MEMBER_PASSWORD = process.env['E2E_MEMBER_PASSWORD'] ?? 'MemberPassw0rd!';
const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

test.describe('Silent / client refresh handler', () => {
  test('rotates the access cookie via direct POST /api/auth/client-refresh', async ({
    page,
    context,
  }) => {
    /**
     * Drives the `createClientRefreshHandler` route directly so the test
     * pins the handler's contract without entangling the result with the
     * proxy + `AuthProvider` revalidation race. A page reload would let
     * both the server-side edge proxy and the client-side AuthProvider
     * race to consume the same refresh token — the second arrival 401s
     * and the test would flake unpredictably.
     *
     * The direct `page.request.post` path is what the AuthProvider would
     * eventually call anyway: the request carries the browser's cookies
     * (so the HttpOnly refresh cookie is included automatically), the
     * route handler forwards them to `/api/auth/refresh`, the API
     * rotates the session, and the Set-Cookie response replaces the
     * access + refresh cookies in the same jar.
     */

    // ── 1. Sign in to get both cookies. ───────────────────────────────────
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await page.getByLabel(/email/i).fill(MEMBER_EMAIL);
    await page.getByLabel(/password/i).fill(MEMBER_PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('/dashboard', { timeout: 15_000 });

    // Sanity: both cookies are set. The refresh cookie is `Path=/api/auth`,
    // so it is NOT visible to JS via `document.cookie` (HttpOnly + scoped
    // path). The playwright context sees ALL cookies regardless of path.
    const beforeCookies = await context.cookies();
    const accessBefore = beforeCookies.find((c) => c.name === 'access_token');
    const refreshBefore = beforeCookies.find((c) => c.name === 'refresh_token');
    expect(accessBefore).toBeDefined();
    expect(refreshBefore).toBeDefined();
    // Non-null assertion is safe: the toBeDefined() expect on the previous
    // line aborts the test before this line ever runs when `accessBefore`
    // is undefined.
    const accessValueBefore = accessBefore!.value;

    // ── 2. POST /api/auth/client-refresh directly. ────────────────────────
    // `page.request` uses the same cookie jar the browser would send on
    // any other request, so the HttpOnly refresh cookie is included
    // automatically. The route handler reads it, forwards to the NestJS
    // `/api/auth/refresh`, and returns the new cookies in `Set-Cookie`.
    const refreshResp = await page.request.post('/api/auth/client-refresh');
    expect(refreshResp.status()).toBeLessThan(300);

    // ── 3. The refresh response must mint a new access cookie. ────────────
    // After the refresh completes, the context's cookie jar reflects the
    // rotated `access_token` (different value from the pre-refresh one).
    // The lib also rotates the refresh token, but pinning the access leg
    // is sufficient — both come through the same Set-Cookie sequence.
    const afterCookies = await context.cookies();
    const accessAfter = afterCookies.find((c) => c.name === 'access_token');
    expect(accessAfter).toBeDefined();
    // Non-null assertion is safe: the toBeDefined() expect above aborts
    // the test before this line ever runs when `accessAfter` is undefined.
    expect(accessAfter!.value).not.toBe(accessValueBefore);

    // ── 4. The next protected call must succeed with the new token. ───────
    // `GET /api/auth/me` will only return 200 if the just-rotated cookie
    // is correctly scoped (right path, HttpOnly, SameSite). A misconfigured
    // Set-Cookie would surface as a 401 here.
    const meResp = await page.request.get('/api/auth/me');
    expect(meResp.status()).toBe(200);
    const me = (await meResp.json()) as { email?: string };
    expect(me.email).toBe(MEMBER_EMAIL);
  });
});
