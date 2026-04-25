/**
 * @fileoverview Vitest configuration for apps/web unit tests.
 *
 * Uses jsdom environment so React components and browser-side modules
 * (WebSocket, document.cookie, localStorage) are available during tests.
 * Path aliases mirror the tsconfig `@/*` mapping so imports resolve correctly.
 *
 * @module vitest.config
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'e2e'],
  },
  resolve: {
    alias: {
      '@': __dirname,
    },
  },
});
