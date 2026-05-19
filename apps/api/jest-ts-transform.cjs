'use strict';

/**
 * @file jest-ts-transform.cjs
 * @description Custom Jest transformer that wraps ts-jest and injects
 * `/* istanbul ignore next *\/` directives before TypeScript
 * `emitDecoratorMetadata` conditional expressions.
 *
 * TypeScript with `emitDecoratorMetadata: true` emits the following pattern
 * for every class-typed constructor parameter and return type:
 *
 *   typeof (_a = typeof X !== "undefined" && X) === "function" ? _a : Object
 *
 * In Node.js, `X` (an imported class) is always defined, so the ternary always
 * evaluates to `X` and the `: Object` branch is permanently unreachable.
 * Istanbul tracks this unreachable branch, making 100% branch coverage
 * otherwise impossible.
 *
 * This transformer post-processes ts-jest's compiled output to tell Istanbul
 * to skip those branches without touching any real logic coverage.
 *
 * @layer tooling
 */

// Matches the TypeScript-emitted decorator-metadata conditional expression:
//   typeof (_a = typeof Module.Class !== "undefined" && Module.Class)
//     === "function" ? _a : Object
//
// The module-qualified name may contain dots (e.g. prisma_service_js_1.PrismaService).
const METADATA_TERNARY_RE =
  /typeof\s+\(\w+\s*=\s*typeof\s+[\w.]+\s*!==\s*"undefined"\s*&&\s*[\w.]+\)\s*===\s*"function"\s*\?\s*\w+\s*:\s*Object/g;

/**
 * Injects `/* istanbul ignore next *\/` before every TypeScript metadata
 * ternary in the compiled JavaScript so Istanbul skips the unreachable
 * false-branch.
 *
 * @param {string} code - Compiled JavaScript source.
 * @returns {string} Patched source with ignore directives.
 */
function patchCode(code) {
  return code.replace(METADATA_TERNARY_RE, '/* istanbul ignore next */ $&');
}

/**
 * Normalises a transformer result to `{ code, map? }`, applies the patcher,
 * and returns the same shape.
 *
 * @param {string | { code: string; map?: string }} result
 * @param {(code: string) => string} patcher
 * @returns {string | { code: string; map?: string }}
 */
function patchResult(result, patcher) {
  if (typeof result === 'string') return patcher(result);
  return { ...result, code: patcher(result.code) };
}

// Lazily created inner transformer, keyed by JSON-serialised config.
/** @type {Map<string, import('ts-jest').TsJestTransformer>} */
const cache = new Map();

/**
 * Returns a memoised ts-jest transformer for the given config object.
 *
 * @param {object} cfg - ts-jest transformer config from `options.transformerConfig`.
 * @returns {import('ts-jest').TsJestTransformer}
 */
function inner(cfg) {
  const key = JSON.stringify(cfg ?? {});
  if (!cache.has(key)) {
    const tsJest = require('ts-jest');
    cache.set(key, tsJest.default.createTransformer(cfg ?? {}));
  }
  return /** @type {import('ts-jest').TsJestTransformer} */ (cache.get(key));
}

/** @type {import('@jest/transform').SyncTransformer} */
const transformer = {
  process(sourceText, sourcePath, options) {
    const result = inner(options.transformerConfig).process(sourceText, sourcePath, options);
    return patchResult(result, patchCode);
  },

  async processAsync(sourceText, sourcePath, options) {
    const t = inner(options.transformerConfig);
    const fn = t.processAsync ?? t.process;
    const result = await fn.call(t, sourceText, sourcePath, options);
    return patchResult(result, patchCode);
  },

  getCacheKey(sourceText, sourcePath, options) {
    const t = inner(options.transformerConfig);
    if (t.getCacheKey) {
      return t.getCacheKey(sourceText, sourcePath, options) + ':no-metadata-branches';
    }
    return undefined;
  },

  async getCacheKeyAsync(sourceText, sourcePath, options) {
    const t = inner(options.transformerConfig);
    if (t.getCacheKeyAsync) {
      const k = await t.getCacheKeyAsync(sourceText, sourcePath, options);
      return k + ':no-metadata-branches';
    }
    if (t.getCacheKey) {
      return t.getCacheKey(sourceText, sourcePath, options) + ':no-metadata-branches';
    }
    return undefined;
  },
};

module.exports = transformer;
