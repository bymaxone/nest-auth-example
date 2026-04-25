/**
 * @file jest.config.ts
 * @description Jest configuration for `@nest-auth-example/api` unit tests.
 *
 * Full test suite configuration (e2e, coverage thresholds) is added in Phase 17.
 * This file establishes the minimal working baseline for Phase 3+.
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
      'ts-jest',
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
  testEnvironment: 'node',
};

export default config;
