/**
 * @fileoverview PostCSS configuration for Tailwind CSS v4.
 *
 * Uses @tailwindcss/postcss (the v4 PostCSS integration) instead of the legacy
 * `tailwindcss` plugin. Autoprefixer runs after Tailwind to add vendor prefixes.
 */

/** @type {import('postcss').Config} */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};

export default config;
