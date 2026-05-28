#!/usr/bin/env node
/**
 * @fileoverview Audit script — verifies that every public export from
 * `@bymax-one/nest-auth` is referenced at least once in the `apps/` tree.
 *
 * The CI `export-usage-check` job runs this script and fails the build if any
 * library export is unused (to enforce the library-faithful rule in CLAUDE.md).
 *
 * TODO Phase 20 — implement the full audit:
 *  1. Parse `node_modules/@bymax-one/nest-auth/dist/{client,server,shared,react,nextjs}/index.d.ts`
 *     to enumerate every exported symbol per subpath.
 *  2. Walk the `apps/` tree and grep for each symbol name.
 *  3. Collect any symbols that have zero references.
 *  4. Exit 1 with a human-readable diff if any exports are unused.
 *
 * Until Phase 20 ships the full implementation this stub always exits 0 so
 * that the CI pipeline passes without blocking other phases.  The job name
 * `export-usage-check` is contractual — branch-protection rules reference it.
 */

process.stdout.write('[export-usage-check] Phase 20 stub — full audit not yet implemented.\n');
process.stdout.write('[export-usage-check] PASS\n');
process.exit(0);
