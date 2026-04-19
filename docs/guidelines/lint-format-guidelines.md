# Lint & Format Guidelines

Single source of truth for ESLint, Prettier, Husky, lint-staged, and commitlint across the monorepo.

- **ESLint**: `^10.2.x` with flat config (`eslint.config.mjs`)
- **TS-ESLint**: `typescript-eslint@^8.58` with type-checked rules
- **Prettier**: `^3.8.x` (`.prettierrc.mjs`)
- **Husky**: `^9.1` (`.husky/`)
- **lint-staged**: `^16.4` (`lint-staged.config.mjs`)
- **commitlint**: `^20.5` (`commitlint.config.mjs`)

---

## When to read this

Before editing any of the above config files, disabling a rule, adding a new language support, or tweaking the pre-commit pipeline.

---

## ESLint

Root `eslint.config.mjs` handles the entire workspace.

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist', '**/.next', '**/coverage', '**/node_modules', '**/*.d.ts'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  prettier,
);
```

Rules:

- **Type-checked ruleset** (`recommendedTypeChecked`) — catches `any` leakage, floating promises, unsafe member access. `projectService: true` resolves tsconfigs automatically per file.
- **No `eslint-disable`**, inline or file-level. Fix the root cause. An ADR covers the rare exception.
- **Prettier wins formatting**; `eslint-config-prettier` disables style rules that would conflict.
- **`.d.ts`** is ignored — generated files are out of scope.
- Plugin additions (e.g., `eslint-plugin-react-hooks`, `eslint-plugin-import`) require a PR with a rationale; avoid stacking plugins for the sake of it.

### Running

```bash
pnpm lint            # full workspace
pnpm lint --fix      # autofix what's safe
pnpm --filter @nest-auth-example/api lint   # one package
```

CI runs `pnpm lint` on every PR; zero warnings, zero errors.

---

## Prettier

```js
/** @type {import("prettier").Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
  endOfLine: 'lf',
};
```

- **Do not hand-format.** Run `pnpm format` (or rely on the pre-commit hook).
- `.prettierignore` excludes lockfiles, generated Prisma clients, and `dist/`.
- No plugin stack here. If someone proposes `prettier-plugin-tailwindcss`, evaluate: it reorders classes alphabetically; consider whether the cost (diff churn on existing code) is worth it. Current answer: not yet.

### Running

```bash
pnpm format          # write
pnpm format:check    # CI mode — fails if dirty
```

---

## Husky

`.husky/` contains:

- `pre-commit` → `pnpm lint-staged`
- (commitlint removed; see decision in commit `d7b7c68`)

Rules:

- **Never bypass hooks** (`--no-verify`) in a PR. If a hook blocks you, fix the underlying issue.
- **`prepare` script in root `package.json`** installs Husky on `pnpm install`. Do not remove.

---

## lint-staged

```js
export default {
  '*.{ts,tsx,js,jsx,mjs,cjs}': ['prettier --write', 'eslint --fix'],
  '*.{json,md,yml,yaml}': ['prettier --write'],
};
```

- Runs only on staged files — fast.
- Autofixes and re-stages. A failure here is an actual lint error, not a formatting nit.

---

## commitlint

```js
export default { extends: ['@commitlint/config-conventional'] };
```

Currently **not wired to a hook** — intentional per commit `d7b7c68` (Husky was too noisy during scaffolding). The config stays so authors still follow the format and it's trivial to re-enable.

Conventional Commits format:

```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

Allowed types (subset we actually use): `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`, `build`.

Scopes mirror workspace/feature boundaries: `api`, `web`, `infra`, `docs`, `deps`, `release`.

See [git-workflow.md](git-workflow.md) for the full PR + commit narrative.

---

## EditorConfig

`.editorconfig` covers editors that don't read Prettier directly:

```
indent_size = 2
indent_style = space
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

Keep in sync with Prettier.

---

## Editors

- **VS Code / Cursor**: install ESLint + Prettier extensions. Set `"editor.formatOnSave": true` and `"editor.defaultFormatter": "esbenp.prettier-vscode"`.
- **WebStorm / IntelliJ**: "Automatic ESLint configuration" + "Prettier: run on save" + "Use Prettier for project formatter."
- No `.vscode/settings.json` is committed — each contributor owns their editor setup.

---

## Common pitfalls

1. **Disabling a rule inline** — the fix is usually the rule. Open a discussion instead of suppressing.
2. **`eslint --fix` overwrites unrelated files** — run `pnpm lint --fix` per PR, not across old branches.
3. **Mismatched editor vs Prettier config** — the editor formats to 4 spaces; Prettier to 2. `.editorconfig` exists to prevent this.
4. **Running Prettier with a plugin nobody else installed** — diffs explode on other machines. Install via the root `package.json` or don't use.
5. **Hook bypass becomes muscle memory** — if `--no-verify` shows up in `git log`, the hook needs fixing, not avoiding.
6. **Committing a broken `eslint.config.mjs`** — all lint runs fail. Test before pushing.

---

## References

- ESLint flat config: https://eslint.org/docs/latest/use/configure/configuration-files
- typescript-eslint: https://typescript-eslint.io/getting-started
- Prettier: https://prettier.io/docs/configuration
- Husky: https://typicode.github.io/husky
- lint-staged: https://github.com/okonet/lint-staged
- commitlint: https://commitlint.js.org
