/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  plugins: ['prettier-plugin-tailwindcss'],
  // Tailwind v4 declares the theme in CSS, so the class sorter has to read the
  // stylesheet entry point rather than the JS config: pointed at the config it
  // sees no theme at all and files every custom utility — `brand-*`,
  // `animate-glow-*` — under "unknown", which sorts them ahead of the real
  // utilities. Path resolves relative to this file.
  tailwindStylesheet: './apps/web/app/globals.css',
  tailwindFunctions: ['cn', 'cva'],
};
