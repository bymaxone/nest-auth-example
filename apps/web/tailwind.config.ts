/**
 * @fileoverview Tailwind CSS v4 configuration for apps/web.
 *
 * Tailwind v4 is configured in CSS, not JavaScript: the design tokens, the
 * color palette and the font stacks all live in the `@theme` block of
 * `app/globals.css`, which is the single source of truth for this app's
 * utilities. This file therefore carries only what has no CSS equivalent —
 * the content globs — and must stay free of a `theme` block: a JS `theme` is
 * read only when a `@config` directive points at this file, so anything added
 * here would be silently ignored at build time.
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
};

export default config;
