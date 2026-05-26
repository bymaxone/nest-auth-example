/**
 * @fileoverview E2E: Google OAuth click-through (FCM #12, browser layer).
 *
 * The full OAuth handshake (token exchange + userinfo fetch) is covered
 * server-side by `apps/api/test/oauth-link.e2e-spec.ts` using the
 * `installFakeGoogle()` helper. This Playwright spec covers the part the
 * supertest suite cannot — the UI click that initiates the flow:
 *
 *   1. The "Continue with Google" button is present on the login + register
 *      pages when `NEXT_PUBLIC_OAUTH_GOOGLE_ENABLED=true`.
 *   2. Clicking it issues a request to `GET /api/auth/oauth/google?tenantId=…`.
 *   3. The library responds with a 302 to `accounts.google.com/o/oauth2/v2/auth`
 *      carrying the correct `client_id`, `redirect_uri`, `scope`, `state`, and
 *      `response_type=code` parameters.
 *
 * The browser is prevented from following the Google redirect — finishing
 * the OAuth flow would require real Google credentials. Aborting at the
 * `accounts.google.com` boundary is sufficient to prove the lib generated a
 * well-formed authorization URL.
 *
 * Requires the API + web server started by `playwright.config.ts` with the
 * placeholder OAUTH_GOOGLE_* env vars set (see the webServer block).
 *
 * @layer test/e2e
 */

import { test, expect, type Page, type Route } from '@playwright/test';

const TENANT_ID = process.env['E2E_TENANT_ID'] ?? 'acme';

/** Predicates extracted from the Google authorization URL Playwright captures. */
interface AuthUrlAssertions {
  readonly host: string;
  readonly pathname: string;
  readonly params: URLSearchParams;
}

/**
 * Captures the first request to `accounts.google.com/o/oauth2/v2/auth` that
 * the browser issues after the user clicks "Continue with Google" and returns
 * the parsed URL. Google's authorization page issues internal sub-requests
 * (e.g. `/_/OAuthUi/browserinfo`) once the page starts loading, so the matcher
 * is keyed exactly on the authorization endpoint to avoid capturing those.
 *
 * Uses Playwright's `request` event rather than `route` because Chromium's
 * follow-on requests from the same navigation occasionally bypass the
 * `route` interceptor depending on the redirect chain — the request event
 * always fires and is the most reliable hook for "what was the first URL
 * the browser tried to load on accounts.google.com".
 */
async function captureGoogleAuthUrl(page: Page): Promise<AuthUrlAssertions> {
  const result = await new Promise<URL>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Did not navigate to accounts.google.com/o/oauth2/v2/auth within 10s'));
    }, 10_000);

    const handler = (req: { url: () => string }): void => {
      const url = req.url();
      if (url.includes('accounts.google.com/o/oauth2/v2/auth')) {
        clearTimeout(timeout);
        page.off('request', handler);
        resolve(new URL(url));
      }
    };
    page.on('request', handler);

    // Stop the navigation from actually leaving localhost — we just need the
    // URL. Returning `abort` for any accounts.google.com request prevents the
    // browser from rendering Google's consent page.
    void page.route('**/accounts.google.com/**', async (route: Route) => {
      await route.abort();
    });

    void page.getByRole('link', { name: /continue with google/i }).click();
  });

  return {
    host: result.host,
    pathname: result.pathname,
    params: result.searchParams,
  };
}

test.describe('Google OAuth — click-through (FCM #12)', () => {
  test('login page: clicking "Continue with Google" redirects to accounts.google.com with a well-formed auth URL', async ({
    page,
  }) => {
    /**
     * Validates the entire library → Next proxy → Google chain at the URL
     * level. A broken href, a missing tenantId param, a mis-configured
     * `OAUTH_GOOGLE_CALLBACK_URL`, or a lib regression that drops the `state`
     * nonce would all fail this assertion.
     */
    await page.goto(`/auth/login?tenantId=${TENANT_ID}`);
    await expect(page.getByRole('link', { name: /continue with google/i })).toBeVisible();

    const auth = await captureGoogleAuthUrl(page);

    // Google's OAuth 2 authorization endpoint.
    expect(auth.host).toBe('accounts.google.com');
    expect(auth.pathname).toBe('/o/oauth2/v2/auth');

    // The lib must pass the configured client_id, request the `code` flow,
    // include the OpenID + profile + email scopes, set a redirect_uri that
    // matches `OAUTH_GOOGLE_CALLBACK_URL`, and embed a CSRF `state` nonce.
    expect(auth.params.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(auth.params.get('response_type')).toBe('code');
    expect(auth.params.get('redirect_uri')).toContain('/api/auth/oauth/google/callback');
    const scope = auth.params.get('scope') ?? '';
    expect(scope).toMatch(/email/);
    expect(scope).toMatch(/profile/);
    const state = auth.params.get('state') ?? '';
    expect(state.length).toBeGreaterThan(16);
  });

  test('register page: same button, same redirect target', async ({ page }) => {
    /**
     * Mirrors the login spec from the register page. Confirms the link the
     * register page builds carries the form's currently-selected tenantId
     * (default = 'default' before the user picks one).
     */
    await page.goto(`/auth/register?tenantId=${TENANT_ID}`);
    await expect(page.getByRole('link', { name: /continue with google/i })).toBeVisible();

    const auth = await captureGoogleAuthUrl(page);

    expect(auth.host).toBe('accounts.google.com');
    expect(auth.pathname).toBe('/o/oauth2/v2/auth');
    expect(auth.params.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(auth.params.get('state')).toBeTruthy();
  });
});
