'use strict';
// Sets environment variable defaults that have Zod schema defaults but are NOT
// explicitly set by individual e2e test files. Runs as a Jest setupFile before
// each test file's ES module imports are evaluated, ensuring these values are
// present in process.env when ConfigModule.forRoot() runs during class-decoration
// time (which happens before the test file's module body can assign them).
//
// Individual test files still set DATABASE_URL, REDIS_URL, JWT_SECRET, etc. in
// their own module body — those come too late for ConfigModule.forRoot but reach
// ConfigService.get() because forRoot no longer uses the validate snapshot.

// SMTP_FROM has a Zod default ('no-reply@nest-auth-example.dev') but test files
// do not set it; MailpitEmailProvider calls config.getOrThrow('SMTP_FROM').
process.env['SMTP_FROM'] = process.env['SMTP_FROM'] ?? 'no-reply@nest-auth-example.dev';

// OAuth env vars must be present at class-decoration time (before ESM imports
// are evaluated) because isGoogleOAuthConfigured() in auth.module.ts reads
// process.env synchronously when the @Module() decorator runs. Individual test
// files that set their own OAuth vars do so too late (after import hoisting) —
// these defaults ensure the OAuth controller is always mounted in the test stack.
// CALLBACK_URL uses port 4000; the actual URL built by buildAuthOptions reads
// from ConfigService inside useFactory (which runs after all module body code),
// so per-spec overrides of OAUTH_GOOGLE_CALLBACK_URL in test files DO take effect.
process.env['OAUTH_GOOGLE_CLIENT_ID'] = process.env['OAUTH_GOOGLE_CLIENT_ID'] ?? 'test-client-id';
process.env['OAUTH_GOOGLE_CLIENT_SECRET'] =
  process.env['OAUTH_GOOGLE_CLIENT_SECRET'] ?? 'test-client-secret';
process.env['OAUTH_GOOGLE_CALLBACK_URL'] =
  process.env['OAUTH_GOOGLE_CALLBACK_URL'] ??
  'http://localhost:4000/api/auth/oauth/google/callback';
