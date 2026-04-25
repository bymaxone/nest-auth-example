/**
 * @fileoverview Vitest global setup — extends `expect` with jest-dom matchers.
 *
 * Imported via `vitest.config.ts#test.setupFiles`. Runs once before each test
 * file so DOM assertions like `toBeInTheDocument()` are available everywhere.
 *
 * @module vitest.setup
 */

import '@testing-library/jest-dom';
