#!/usr/bin/env node
/**
 * @fileoverview Audit script — verifies that every public export from
 * `@bymax-one/nest-auth` is referenced at least once in the `apps/` tree.
 *
 * CI job `export-usage-check` runs this script and fails the build on a
 * non-zero exit to enforce the library-faithful rule documented in CLAUDE.md.
 *
 * Subpaths are discovered dynamically from
 * `node_modules/@bymax-one/nest-auth/dist/`. Each subpath's `index.d.ts` is
 * parsed for exported symbols; the `apps/api/src` and `apps/web` trees are then
 * searched for a word-boundary occurrence of each symbol. A `.audit-ignore.json`
 * file at the repo root can suppress intentionally-undemonstrated exports.
 *
 * @see docs/DEVELOPMENT_PLAN.md §20
 * @layer tooling
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = join(ROOT, 'node_modules/@bymax-one/nest-auth/dist');
// Include the full apps/api workspace (src + test) so test helpers that
// demonstrate library utilities (crypto-roundtrip.spec.ts, dto-schema.spec.ts)
// count as valid usage sites. apps/web is scanned in full as well.
const APPS_DIRS = [join(ROOT, 'apps/api'), join(ROOT, 'apps/web')];
const IGNORE_FILE = join(ROOT, '.audit-ignore.json');

/** Directories to skip while walking the apps tree. */
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '.turbo', 'out', 'build']);

// ── File walking ──────────────────────────────────────────────────────────────

/**
 * Recursively collect `.ts` and `.tsx` file paths under `dir`.
 *
 * @param {string} dir - Directory to walk.
 * @returns {string[]} Absolute paths to every `.ts`/`.tsx` file found.
 */
function walkTs(dir) {
  const acc = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      acc.push(...walkTs(full));
    } else if (entry.isFile()) {
      const ext = extname(entry.name);
      if (ext === '.ts' || ext === '.tsx') acc.push(full);
    }
  }
  return acc;
}

// ── Export parsing ────────────────────────────────────────────────────────────

/**
 * Parse exported symbol names from a TypeScript declaration file.
 *
 * Handles the following patterns:
 * - `export { Foo, Bar as Baz }` — Foo and Baz are added (aliased name wins).
 * - `export type { Foo }` — included (types are part of the public API).
 * - `export const|let|var|function|class|interface|enum|type|namespace Foo`.
 * - `export [declare] [abstract] [async] class Foo`.
 * - `export default` — recorded as the literal string `'default'`.
 * - Re-exports `export { ... } from 'external-package'` — skipped (the symbol
 *   lives in the originating package and is already audited from there).
 *
 * @param {string} dts - UTF-8 content of an `index.d.ts` file.
 * @returns {Set<string>} Exported symbol names.
 */
function parseExports(dts) {
  const symbols = new Set();
  let m;

  // export { Foo, type Bar, Baz as Qux } [from '...']
  const braceRe = /^export\s+(?:type\s+)?\{([^}]+)\}([^;\n]*)?;/gm;
  while ((m = braceRe.exec(dts)) !== null) {
    const trailer = (m[2] ?? '').trim();
    // Skip re-exports from any external package (including sibling subpaths —
    // those symbols are captured when auditing the originating subpath).
    if (/from\s+['"]/.test(trailer)) continue;
    for (const part of m[1].split(',')) {
      const clean = part.trim().replace(/^type\s+/, '');
      if (!clean) continue;
      // 'Foo as Bar' → keep 'Bar' (the name the consumer imports).
      const asMatch = /\bas\s+(\w+)/.exec(clean);
      if (asMatch) {
        const name = asMatch[1];
        if (name && name !== 'default') symbols.add(name);
      } else {
        const nameMatch = /^(\w+)/.exec(clean);
        if (nameMatch && nameMatch[1] !== 'default') symbols.add(nameMatch[1]);
      }
    }
  }

  // export [declare] [abstract] [async] const|let|var|function|class|... Foo
  const namedRe =
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:const|let|var|function|class|interface|enum|type|namespace)\s+(\w+)/gm;
  while ((m = namedRe.exec(dts)) !== null) {
    symbols.add(m[1]);
  }

  // export default
  if (/^export\s+default\b/m.test(dts)) {
    symbols.add('default');
  }

  return symbols;
}

// ── Symbol search ─────────────────────────────────────────────────────────────

/**
 * Build a single corpus string from all TypeScript source files in `apps/`.
 * Concatenating with a sentinel keeps word-boundary matches from wrapping
 * across file boundaries.
 *
 * @param {string[]} files - Absolute file paths.
 * @returns {string}
 */
function buildCorpus(files) {
  return files.map((f) => readFileSync(f, 'utf8')).join('\n\0\n');
}

/**
 * Test whether `symbol` appears at a word boundary in `corpus`.
 *
 * @param {string} corpus - Concatenated source content.
 * @param {string} symbol - Identifier to search for.
 * @returns {boolean}
 */
function isUsed(corpus, symbol) {
  return new RegExp(`\\b${symbol}\\b`).test(corpus);
}

// ── Ignore file ───────────────────────────────────────────────────────────────

/**
 * Load `.audit-ignore.json` from the repo root.
 *
 * The file is a JSON object mapping `"<subpath>.<symbol>"` keys to reason
 * strings. Missing file is treated as an empty ignore list.
 *
 * @returns {Record<string, string>}
 */
function loadIgnore() {
  try {
    return JSON.parse(readFileSync(IGNORE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const start = Date.now();

// 1. Discover subpaths (dynamic, not hardcoded).
/** @type {string[]} */
const subpaths = readdirSync(DIST, { withFileTypes: true })
  .filter((e) => {
    if (!e.isDirectory()) return false;
    try {
      statSync(join(DIST, e.name, 'index.d.ts'));
      return true;
    } catch {
      return false;
    }
  })
  .map((e) => e.name)
  .sort();

process.stdout.write(`[export-usage-check] Subpaths found: ${subpaths.join(', ')}\n`);

// 2. Parse exported symbols per subpath.
/** @type {Map<string, Set<string>>} Map from subpath name → Set of symbol names. */
const symbolsBySubpath = new Map();
let totalSymbols = 0;

for (const subpath of subpaths) {
  const dts = readFileSync(join(DIST, subpath, 'index.d.ts'), 'utf8');
  const symbols = parseExports(dts);
  symbolsBySubpath.set(subpath, symbols);
  totalSymbols += symbols.size;
  process.stdout.write(`[export-usage-check] ${subpath}: ${symbols.size} exports\n`);
}

// 3. Load ignore list.
const ignore = loadIgnore();
const ignoredCount = Object.keys(ignore).length;
if (ignoredCount > 0) {
  process.stdout.write(
    `[export-usage-check] Ignoring ${ignoredCount} entries from .audit-ignore.json\n`,
  );
}

// 4. Build source corpus from apps/.
const sourceFiles = APPS_DIRS.flatMap((dir) => {
  try {
    return walkTs(dir);
  } catch {
    return [];
  }
});
process.stdout.write(`[export-usage-check] Scanning ${sourceFiles.length} source files in apps/\n`);
const corpus = buildCorpus(sourceFiles);

// 5. Check each symbol.
/** @type {Map<string, string[]>} Missing symbols grouped by subpath. */
const missing = new Map();

for (const [subpath, symbols] of symbolsBySubpath) {
  for (const symbol of symbols) {
    const key = `${subpath}.${symbol}`;
    if (key in ignore) continue;
    if (!isUsed(corpus, symbol)) {
      if (!missing.has(subpath)) missing.set(subpath, []);
      missing.get(subpath).push(symbol);
    }
  }
}

const elapsed = Date.now() - start;
process.stdout.write(`[export-usage-check] Scan complete in ${elapsed}ms\n`);

// 6. Report results.
if (missing.size === 0) {
  process.stdout.write(
    `[export-usage-check] ✓ All ${totalSymbols} exports are referenced in apps/ (${ignoredCount} ignored)\n`,
  );
  process.exit(0);
} else {
  let totalMissing = 0;
  process.stderr.write(`\n[export-usage-check] ✗ Missing usages in apps/:\n`);

  for (const [subpath, symbols] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    process.stderr.write(`\n  ${subpath}:\n`);
    for (const sym of symbols.sort()) {
      process.stderr.write(`    Missing in apps/: ${subpath}.${sym}\n`);
      totalMissing++;
    }
  }

  process.stderr.write(`\nTo suppress an entry, add it to .audit-ignore.json:\n`);
  process.stderr.write(`{\n`);
  for (const [subpath, symbols] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    for (const sym of symbols.sort()) {
      process.stderr.write(
        `  "${subpath}.${sym}": "reason — see https://github.com/bymaxone/nest-auth-example/issues/N",\n`,
      );
    }
  }
  process.stderr.write(`}\n\n`);
  process.stderr.write(
    `[export-usage-check] ✗ ${totalMissing} missing (${ignoredCount} ignored)\n`,
  );
  process.exit(1);
}
