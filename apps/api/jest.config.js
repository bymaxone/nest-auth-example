/**
 * @file jest.config.ts
 * @description Jest configuration for `@nest-auth-example/api` unit tests.
 *
 * Coverage gates enforce 100% across all four metrics (statements, branches,
 * functions, lines). Branch coverage at 100% is achieved via a custom
 * transformer (`jest-ts-transform.cjs`) that wraps ts-jest and injects
 * `/* istanbul ignore next *\/` before the `typeof X !== "undefined" && X ?
 * X : Object` ternaries emitted by TypeScript's `emitDecoratorMetadata`
 * feature — those ternaries are permanently unreachable in Node.js and
 * cannot be exercised by any test.
 *
 * @layer tooling
 */
const config = {
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
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.module.ts',
    '!src/main.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.d.ts',
  ],
  coverageReporters: ['text', 'lcov'],
  coverageThreshold: {
    global: {
      branches: 100,
      lines: 100,
      functions: 100,
      statements: 100,
    },
  },
};
export default config;
