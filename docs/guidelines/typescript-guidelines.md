# TypeScript Guidelines

Strictly typed TypeScript for every package in the workspace.

- **Version**: `^6.0.x`
- **Base config**: `tsconfig.base.json` at the repo root
- **Module system**: ESM (`"type": "module"`), Node 24+
- **Official docs**: https://www.typescriptlang.org/docs

---

## When to read this

Before writing any `.ts` / `.tsx` file, extending `tsconfig.json`, authoring a generic, or touching a declaration file.

---

## Strictness is non-negotiable

`tsconfig.base.json` is extended by every package. Do not weaken any of these flags.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  }
}
```

Key consequences for day-to-day code:

- **`noUncheckedIndexedAccess`**: `arr[i]` and `record[key]` are typed `T | undefined`. Always narrow before use.
- **`exactOptionalPropertyTypes`**: `{ name?: string }` does not accept `{ name: undefined }`. Omit the key or widen with `name?: string | undefined` deliberately.
- **`verbatimModuleSyntax`**: imports used only as types must be written as `import type { Foo } from '...'`. Mixed imports need separation.
- **`isolatedModules`**: no `const enum`, no namespace-only files, no implicit re-exports without a `type` keyword.

---

## Zero `any`

If `any` appears, something is wrong. In preference order:

1. **Import the real type** from the library.
2. **`unknown`** for genuinely untyped boundaries — refine with a guard.
3. **Generic parameter** when the function is polymorphic.
4. **Zod or DTO** at the trust boundary, let TS infer the rest.

```ts
// ❌ any hides bugs
function parseConfig(raw: any) {
  return raw.value;
}

// ✅ unknown + guard
function parseConfig(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null && 'value' in raw && typeof raw.value === 'string') {
    return raw.value;
  }
  throw new Error('Invalid config');
}

// ✅ Zod at the boundary
const schema = z.object({ value: z.string() });
function parseConfig(raw: unknown): z.infer<typeof schema> {
  return schema.parse(raw);
}
```

**Banned**:

- `any` (anywhere, including tests)
- `as any`
- `// @ts-ignore` / `// @ts-expect-error` / `// @ts-nocheck`
- `// eslint-disable` (inline or file-level)

If you genuinely believe a suppression is the right call, write an ADR in `docs/decisions/`.

---

## Types over interfaces (by default)

- **`type` for data shapes and unions.** Predictable, no declaration merging surprises.
- **`interface` only when** a public class or library truly requires extension via declaration merging (rare).
- **Union literals** over TS `enum`:
  ```ts
  type Status = 'active' | 'pending' | 'suspended' | 'locked';
  ```
  Enum-typed values don't round-trip through JSON and inflate bundle size. The `status` column on `User` is a `string` in Prisma; types pin the allowed values.
- **`as const` objects** for named constant maps:
  ```ts
  export const AUDIT_EVENT = {
    USER_CREATED: 'USER_CREATED',
    USER_SUSPENDED: 'USER_SUSPENDED',
  } as const;
  export type AuditEvent = (typeof AUDIT_EVENT)[keyof typeof AUDIT_EVENT];
  ```

---

## Null and undefined

- `undefined` is the Node default. Return `undefined` from optional selectors.
- `null` for values that are explicitly absent in the database (Prisma surfaces `null` for nullable columns). Keep the two distinct.
- Do not widen with `??` when you have already narrowed with TypeScript; it drops type refinement silently.

---

## Generics

- Name type parameters descriptively (`TUser`, `TInput`) when the function has more than one. Single-parameter generics can stay `T`.
- Constrain with `extends`:
  ```ts
  function keyOf<TObject extends Record<string, unknown>>(obj: TObject, key: keyof TObject) {
    return obj[key];
  }
  ```
- Prefer inference; do not spell generics at call sites unless needed to resolve ambiguity.

---

## Branded types at API boundaries

For IDs that must not be mixed up:

```ts
type UserId = string & { readonly __brand: 'UserId' };
type TenantId = string & { readonly __brand: 'TenantId' };

const toUserId = (s: string): UserId => s as UserId;
```

Use inside service signatures that accept IDs — prevents passing a `tenantId` where a `userId` is expected.

---

## Inference vs explicit annotation

- **Local variables**: let TS infer. Annotate only when the inferred type is wider than intended.
- **Function return types**: annotate on exported functions (public API). Private helpers can rely on inference.
- **Props**: always annotate — the editor experience for consumers depends on it.
- **ESM exports**: when `verbatimModuleSyntax` is on, type-only re-exports require `export type { X }`.

---

## Error handling

- Throw `Error` subclasses when the thrown value is caught further up; throw domain-specific exceptions (`BadRequestException`, etc.) when they map directly to HTTP.
- `try/catch (err)` — `err` is `unknown` (TS 4.4+). Narrow with `err instanceof Error` before reading `.message`.
- Never reassign the caught binding.

---

## `unknown` guards

Write the guard once, reuse it:

```ts
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function hasKey<K extends string>(v: unknown, key: K): v is Record<K, unknown> {
  return isRecord(v) && key in v;
}
```

Use in any place that consumes parsed JSON or external data without Zod.

---

## Module system

- `"type": "module"` in every package.json. All files are ES modules.
- **Relative imports carry the `.js` extension**, even from `.ts` sources: `import { foo } from './foo.js'`. Node 24 ESM requires it; bundler resolution in `tsconfig` handles the mapping.
- Do not mix `require` and `import`. If a dependency is CJS-only, use the `import … from 'module'` interop that `esModuleInterop` provides.
- **Barrel exports** (`index.ts`) only when they genuinely reduce friction. Avoid deep barrels — they kill tree-shaking.

---

## Path aliases

- `apps/api` and `apps/web` each define an alias in their own `tsconfig.json`:
  - API: `@/*` → `src/*`
  - Web: `@/*` → `src/*` (convention; may target `app/*`, `lib/*`, `components/*`)
- No `../../` beyond one level. Reach for the alias.
- Root `tsconfig.base.json` holds compiler options, not paths — paths are package-local.

---

## Declaration files (`*.d.ts`)

- Place under `apps/*/src/types/` when they augment the app.
- Never hand-edit `node_modules/` types. If a library's types are wrong, file an upstream issue and patch via module augmentation.
- Module augmentation lives in a single `types/augmentations.d.ts`:
  ```ts
  declare module 'express-serve-static-core' {
    interface Request {
      id?: string;
      tenantId?: string;
    }
  }
  ```

---

## JSDoc & documentation

Documentation policy belongs to [coding-style.md](coding-style.md). TypeScript-specific rule: **types do not replace docstrings**. A `CreateProjectDto` still benefits from a one-line "What is a project?" if the name is ambiguous.

---

## Testing types

- Use `expectTypeOf` from `vitest` or `tsd` when a type is load-bearing (generic inference, branded IDs).
- Compile-time regressions: a deliberately incorrect line with `// @ts-expect-error` is acceptable **only** inside type-level tests — never in production code.

---

## Common pitfalls

1. **`any` in catch clauses** — TS 4.4+ defaults caught values to `unknown`; do not revert to `any`.
2. **Missing `await` on `Promise`-returning functions** — TS will flag many cases, but not all; watch for floating promises in `void` contexts.
3. **`as` casts** — nearly always a bug. A narrowing guard or a Zod parse is the right fix.
4. **Forgetting the `.js` extension on ESM imports** — works in bundler resolution, fails at Node runtime.
5. **Mixed default + named imports from CJS modules** — with `esModuleInterop` it compiles, but some tools treat the default differently. Prefer named imports where the library supports them.
6. **Returning `T | undefined` without narrowing** — callers forget to check. Either narrow or return a `Result` shape.
7. **Extending `interface` across files unintentionally** — `interface` merges; `type` does not. If merging is what you want, prefer a module augmentation.

---

## References

- TypeScript docs: https://www.typescriptlang.org/docs
- TS ESLint (type-checked rules we enable): https://typescript-eslint.io/getting-started/typed-linting
- `verbatimModuleSyntax`: https://www.typescriptlang.org/tsconfig#verbatimModuleSyntax
- `exactOptionalPropertyTypes`: https://www.typescriptlang.org/tsconfig#exactOptionalPropertyTypes
- `tsconfig.base.json` in this repo
