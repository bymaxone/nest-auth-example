/**
 * @file fake-google.ts
 * @description In-process stub for Google OAuth token-exchange and UserInfo
 * endpoints. Replaces `globalThis.fetch` with an interceptor so the library
 * never hits real Google servers during e2e tests. All other URLs pass through
 * to the original `fetch` implementation.
 *
 * Usage:
 *   installFakeGoogle({ id: 'google-sub-123', email: 'user@test.com', name: 'Test' });
 *   // ... trigger OAuth callback ...
 *   uninstallFakeGoogle();
 *
 * @layer test
 * @see docs/DEVELOPMENT_PLAN.md §Phase 8 P8-3
 */

/** Google token endpoint intercepted by this stub. */
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Google UserInfo endpoint intercepted by this stub. */
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

/** Profile shape returned by the fake UserInfo endpoint. */
export interface FakeGoogleProfile {
  /** Google's internal user identifier (`id` field in the userinfo response). */
  id: string;
  /** Primary email address for the fake profile. */
  email: string;
  /** Display name for the fake profile. */
  name: string;
}

type GlobalFetch = typeof globalThis.fetch;

let savedFetch: GlobalFetch | undefined;

/**
 * Installs a `globalThis.fetch` stub that intercepts Google OAuth requests.
 *
 * - `POST https://oauth2.googleapis.com/token` → returns a fake Bearer access token.
 * - `GET https://www.googleapis.com/oauth2/v2/userinfo` → returns `profile` with
 *   `verified_email: true`.
 * - All other URLs are forwarded to the original `fetch` implementation.
 *
 * Call {@link uninstallFakeGoogle} after the test to restore the original fetch.
 *
 * @param profile - Fake profile data returned by the UserInfo stub.
 */
export function installFakeGoogle(profile: FakeGoogleProfile): void {
  savedFetch = globalThis.fetch;

  globalThis.fetch = (async (
    input: Parameters<GlobalFetch>[0],
    init?: Parameters<GlobalFetch>[1],
  ): Promise<Response> => {
    const urlString: string =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as { url: string }).url;

    if (urlString === GOOGLE_TOKEN_URL) {
      return new Response(
        JSON.stringify({ access_token: 'fake-access-token', token_type: 'Bearer' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (urlString === GOOGLE_USERINFO_URL) {
      return new Response(
        JSON.stringify({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          verified_email: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const original = savedFetch;
    if (original === undefined) {
      throw new Error('fake-google: original fetch is unavailable');
    }
    return original(input, init);
  }) as GlobalFetch;
}

/**
 * Restores the original `globalThis.fetch` saved by {@link installFakeGoogle}.
 * No-op when called before `installFakeGoogle`.
 */
export function uninstallFakeGoogle(): void {
  if (savedFetch !== undefined) {
    globalThis.fetch = savedFetch;
    savedFetch = undefined;
  }
}
