/**
 * @fileoverview E2E: HTTP security headers on the Next.js web front-end.
 *
 * Verifies that `next.config.mjs` injects the expected security headers on
 * every page response:
 *  - `X-Content-Type-Options: nosniff`
 *  - `X-Frame-Options: DENY`
 *  - `Referrer-Policy: strict-origin-when-cross-origin`
 *  - `Content-Security-Policy` (present, with at minimum `default-src 'self'`)
 *
 * Uses direct `page.goto` + `response.headers()` rather than a UI assertion
 * because security headers are a transport-layer concern, not a DOM element.
 * Runs against the full running web dev server (`next dev`).
 *
 * @layer test/e2e
 * @see apps/web/next.config.mjs (headers() configuration)
 * @see docs/DEPLOYMENT.md (security header documentation)
 */

import { test, expect } from '@playwright/test';

test.describe('Web security headers', () => {
  test('the login page response carries X-Content-Type-Options: nosniff', async ({ page }) => {
    /**
     * Scenario: all web responses must carry the nosniff directive. The login
     * page is a public, no-auth route that every visitor hits first —
     * confirming headers here proves the next.config.mjs headers() block runs.
     * Rule: X-Content-Type-Options is set by the Next.js headers() config.
     */
    const response = await page.goto('/auth/login');
    expect(response).not.toBeNull();
    const xCTO = response!.headers()['x-content-type-options'];
    expect(xCTO).toBe('nosniff');
  });

  test('the login page response carries X-Frame-Options: DENY', async ({ page }) => {
    /**
     * Scenario: without X-Frame-Options an attacker can embed the login page
     * in a transparent <iframe> and perform a clickjacking attack that steals
     * credentials.
     * Rule: X-Frame-Options must be DENY on every web response.
     */
    const response = await page.goto('/auth/login');
    expect(response).not.toBeNull();
    const xFO = response!.headers()['x-frame-options'];
    expect(xFO).toBe('DENY');
  });

  test('the login page response carries Referrer-Policy', async ({ page }) => {
    /**
     * Scenario: without a Referrer-Policy the browser may leak the full URL
     * (path + query params, e.g. a token in the reset-password URL) in the
     * Referer header on cross-origin navigations.
     * Rule: Referrer-Policy is set on every web response.
     */
    const response = await page.goto('/auth/login');
    expect(response).not.toBeNull();
    const referrerPolicy = response!.headers()['referrer-policy'];
    expect(referrerPolicy).toBe('strict-origin-when-cross-origin');
  });

  test('the login page response carries a Content-Security-Policy header', async ({ page }) => {
    /**
     * Scenario: a Content-Security-Policy header restricts what resources the
     * browser can load, reducing the attack surface for XSS. Even a permissive
     * CSP is better than none — it signals intent and allows incremental
     * tightening.
     * Rule: CSP is present and includes at minimum `default-src 'self'`.
     */
    const response = await page.goto('/auth/login');
    expect(response).not.toBeNull();
    const csp = response!.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
  });
});
