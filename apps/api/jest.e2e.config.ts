/**
 * @file jest.e2e.config.ts
 * @description Jest configuration for e2e (supertest + real DB/Redis) test suites.
 *
 * Points at `test/**\/*.e2e-spec.ts` and sets `testTimeout: 30_000` to
 * accommodate real-network round trips to Postgres, Redis, and Mailpit.
 *
 * Run via: `pnpm --filter api test:e2e`
 *
 * @layer tooling
 */

import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  testTimeout: 30_000,
  // Each e2e suite manages its own app bootstrap — no shared global setup.
  // The `createTestApp` helper in test/setup.ts runs prisma migrate deploy
  // lazily on first call (guarded by a module-level flag).
};

export default config;
