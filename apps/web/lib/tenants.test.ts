/**
 * @fileoverview Unit tests for the shared tenant picker module — pin the
 * invariants that the login / register / forgot-password pages depend on:
 * the option list is non-empty, the default matches its first entry, and
 * the URL-default resolver gracefully ignores unknown slugs.
 *
 * @layer test/unit
 */

import { describe, it, expect } from 'vitest';
import { TENANT_OPTIONS, DEFAULT_TENANT_SLUG, resolveDefaultTenantSlug } from './tenants';

describe('TENANT_OPTIONS', () => {
  it('is non-empty', () => {
    /**
     * Scenario: the auth pages render `<option>` elements from this list.
     * An empty list would render an empty `<select>` and the form would
     * never submit a valid `tenantId`. Pinned to surface a misconfigured
     * seed mirror as a test failure, not a silent UX regression.
     */
    expect(TENANT_OPTIONS.length).toBeGreaterThan(0);
  });

  it('starts with the slug exposed as DEFAULT_TENANT_SLUG', () => {
    /**
     * Scenario: `DEFAULT_TENANT_SLUG` is declared as a separate constant
     * to dodge `noUncheckedIndexedAccess`. The two must agree — if the
     * seed ever changes order this test catches the drift before it
     * surfaces as a login that submits the wrong workspace.
     */
    const first = TENANT_OPTIONS[0];
    expect(first).toBeDefined();
    // Non-null assertion is safe: toBeDefined() above aborts the test
    // before this line ever runs when `first` is undefined.
    expect(first!.value).toBe(DEFAULT_TENANT_SLUG);
  });

  it('uses unique slugs across all entries', () => {
    /**
     * Scenario: a duplicate slug would render two `<option>` elements
     * that look identical to the user but route to different workspace
     * IDs after the slug-to-CUID resolve. Pinned to catch copy-paste
     * mistakes when adding a third tenant.
     */
    const slugs = TENANT_OPTIONS.map((opt) => opt.value);
    const unique = new Set(slugs);
    expect(unique.size).toBe(slugs.length);
  });
});

describe('resolveDefaultTenantSlug', () => {
  it('returns the URL slug when it matches a known tenant', () => {
    /**
     * Scenario: a welcome email links to `/auth/login?tenantId=globex`.
     * The login page must pre-select `globex` so the user does not have
     * to re-pick the workspace after clicking through.
     */
    expect(resolveDefaultTenantSlug('globex')).toBe('globex');
  });

  it('falls back to DEFAULT_TENANT_SLUG when the URL slug is null', () => {
    /**
     * Scenario: a developer visits `/auth/login` directly with no query
     * params. Without a sane default the `<select>` would render with an
     * undefined `defaultValue` and React would warn about an uncontrolled
     * input. Pinned to keep the resolver consistent with React semantics.
     */
    expect(resolveDefaultTenantSlug(null)).toBe(DEFAULT_TENANT_SLUG);
  });

  it('falls back to DEFAULT_TENANT_SLUG when the URL slug is unknown', () => {
    /**
     * Scenario: an attacker (or a developer experimenting) visits
     * `/auth/login?tenantId=does-not-exist`. The picker must not render
     * an invisible workspace option — that would let a login submit a
     * tenant the API will reject anyway. Falling back to the default
     * keeps the form in a submittable state and the slug-to-CUID resolve
     * surfaces a clear `TenantNotFoundError` if it is ever attempted.
     */
    expect(resolveDefaultTenantSlug('does-not-exist')).toBe(DEFAULT_TENANT_SLUG);
  });
});
