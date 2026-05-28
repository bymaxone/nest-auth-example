/**
 * @file jest.stryker.config.ts
 * @description Stryker-only Jest configuration for `@nest-auth-example/api`.
 *
 * Self-contained replica of `jest.config.ts` with two intentional deltas:
 *   1. `testEnvironment` is swapped for Stryker's instrumented Node env so
 *      `coverageAnalysis: "perTest"` can map every mutant to the exact
 *      tests covering it.
 *   2. `coverageThreshold` is removed — Stryker measures mutation score,
 *      not line coverage, and the strict 100% gate would fail every
 *      sandboxed run when only a subset of tests executes per mutant.
 *
 * The config is duplicated (not imported from `./jest.config`) because the
 * sandbox copies TypeScript files as-is and the project's NodeNext
 * resolution requires explicit `.js` extensions that the sandboxed sibling
 * file does not provide. Inlining keeps Stryker independent from
 * compile-target choices in the base config.
 *
 * @layer tooling
 */

import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      './jest-ts-transform.cjs',
      {
        tsconfig: 'tsconfig.spec.json',
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: '@stryker-mutator/jest-runner/jest-env/node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
};

export default config;
