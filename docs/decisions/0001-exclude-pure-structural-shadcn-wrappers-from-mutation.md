# ADR 0001 — Exclude pure-structural shadcn/Radix wrappers from mutation testing

> **Status**: Accepted
> **Date**: 2026-05-27
> **Author**: Maximiliano Salvatti (`msalvatti@gmail.com`)
> **Supersedes**: —
> **Superseded by**: —

## Context

`apps/web/components/ui/` hosts the project's shadcn/ui design-system
primitives. Most of the files in that folder are **thin wrappers around
Radix UI** (or native HTML elements) whose entire job is to apply Tailwind
`className` strings and forward refs/props. They contain no conditional
logic, no state, no side-effects, no event handlers beyond what Radix
exposes — they exist purely so the rest of the codebase can import a
consistently-styled primitive instead of re-typing the same class lists.

Phase 1 mutation testing exposed the consequence: in the Phase 0 baseline,
`components/ui/` scored **19.86%** as a whole — 116 surviving mutants out
of 145. Drill-down by file (from `BASELINE.md` + the 2026-05-27 full run):

| File                | Mutants | Survived | Score   | Nature                                                               |
| ------------------- | ------- | -------- | ------- | -------------------------------------------------------------------- |
| `alert-dialog.tsx`  | 2       | 2        | 0.00 %  | Pure Radix re-export + className composition                         |
| `avatar.tsx`        | 3       | 3        | 0.00 %  | Pure Radix re-export                                                 |
| `card.tsx`          | 10      | 6        | 40.00 % | Native `<div>` wrappers, one conditional `cn()` call                 |
| `dialog.tsx`        | 14      | 14       | 0.00 %  | Pure Radix re-export                                                 |
| `input.tsx`         | 7       | 6        | 14.29 % | `<input>` + composed `cn()` className                                |
| `sonner.tsx`        | 14      | 14       | 0.00 %  | `<SonnerToaster>` configuration                                      |
| `table.tsx`         | 8       | 8        | 0.00 %  | Native table-element wrappers                                        |
| `tabs.tsx`          | 7       | 7        | 0.00 %  | Pure Radix re-export                                                 |
| `tooltip.tsx`       | 5       | 5        | 0.00 %  | Pure Radix re-export                                                 |
| `dropdown-menu.tsx` | 35      | 34       | 2.78 %  | Mostly className; a handful of `inset && 'pl-8'` conditionals — KEEP |
| `form.tsx`          | 34      | 17       | 50.00 % | Genuine React Hook Form glue (Controller, useFormState) — KEEP       |
| `badge.tsx`         | 2       | 0        | 100 %   | Already 100 %                                                        |
| `button.tsx`        | 4       | 0        | 100 %   | Already 100 %                                                        |
| `label.tsx`         | 0       | 0        | n/a     | No mutants generated                                                 |

Every surviving mutant in the wrappers marked **"pure"** above is one of
two shapes:

1. **`StringLiteral`** on a `className` string. Mutating
   `'rounded-2xl border ...'` to `""` does change the rendered class list,
   but a unit test that asserts on the exact concatenated string is
   asserting on visual styling — not behaviour. Visual regressions are
   not Vitest's job; the existing Playwright suite + design review catch
   them.
2. **`ObjectLiteral`** / **`ArrayDeclaration`** on a Tailwind class array
   passed to `cn()`. Same story: structural styling, not behaviour.

There is no test we can write — short of pinning every literal
`className` value in every wrapper — that would kill these mutants
without also turning the unit suite into a styling snapshot test.
Styling snapshot tests are explicitly out of scope for this project
(see `docs/guidelines/testing-guidelines.md` and the Tailwind v4
"co-located tokens" pattern in `tailwind-guidelines.md`).

## Decision

**Exclude the following files from Stryker `mutate` in
`apps/web/stryker.config.json`:**

- `components/ui/alert-dialog.tsx`
- `components/ui/avatar.tsx`
- `components/ui/card.tsx`
- `components/ui/dialog.tsx`
- `components/ui/input.tsx`
- `components/ui/sonner.tsx`
- `components/ui/table.tsx`
- `components/ui/tabs.tsx`
- `components/ui/tooltip.tsx`

**Keep mutating** these wrappers because they carry genuine logic:

- `components/ui/dropdown-menu.tsx` — `inset && 'pl-8'` conditional and
  the `DropdownMenuShortcut` slot toggling behaviour.
- `components/ui/form.tsx` — React Hook Form `Controller` plumbing,
  `useFormState` error-message derivation.
- `components/ui/button.tsx`, `badge.tsx`, `label.tsx` — already at
  100 %; keep.

The excluded files retain **100 % line coverage** (verified by
`pnpm --filter @nest-auth-example/web run test:cov`). Coverage proves
they render; Stryker would only prove their stylistic strings match a
fixed value — a check that delivers no protective signal for the
behaviours this codebase ships.

## Consequences

### Positive

- The web mutation score is no longer dragged down by ~65 surviving
  StringLiteral mutants that cannot be killed without inventing a
  styling-snapshot regime.
- Authors of new shadcn primitives have a clear rule: if the wrapper is
  purely structural, add it to the exclusion list and update this ADR's
  table. If it carries real behaviour (state, conditionals, event
  handlers), it stays in `mutate`.
- Phase 2's `break` threshold (currently `null`, slated for `80 → 90 → 95`)
  becomes achievable for the web workspace without false friction.

### Negative

- A subtle visual regression in one of the excluded files — e.g., the
  dialog overlay opacity dropped to `0`, leaving the modal floating
  invisibly — would not surface as a mutation-test failure. Mitigated by
  the existing Playwright suite which renders these primitives in real
  user flows.

### Neutral

- The unit-test count for the excluded files is unchanged; coverage
  remains at 100 %. The only thing removed is the Stryker mutation pass
  on those specific files.

## Rule for future contributors

When adding a new file under `components/ui/`:

1. **Default behaviour**: do **not** exclude. Let Stryker mutate it.
2. If the new wrapper is **purely structural** (only `className`
   composition, only Radix/native element re-exports, no state, no
   conditionals beyond design-system props like `variant`/`size` that
   are already covered elsewhere), add it to the exclusion list above
   AND extend this ADR's table.
3. If the wrapper carries any **conditional logic** (`inset && 'pl-8'`),
   **state** (`useState`), **side effects** (`useEffect`), or **event
   handling** beyond `onClick` passthrough, keep it in `mutate` and
   write tests for the conditional paths.

## Alternatives considered

### A. Per-line `// Stryker disable next-line StringLiteral` comments

The mutation-testing guideline allows this pattern. Rejected because
each excluded file would need 5–15 disable directives — each repeating
the same rationale ("purely structural shadcn wrapper, className mutants
are equivalent or purely visual"). The result would be cluttered source
files where the disable directives outnumber the production lines. The
ADR + one-line `mutate` exclusion captures the rationale once.

### B. Project-wide `excludedMutations: ["StringLiteral"]`

Rejected. The codebase contains many `StringLiteral` mutants where the
string is **behaviourally meaningful** — error codes, URLs, log event
names, exception messages, accessibility labels. Project-wide exclusion
would hide real defects in the API layer where this category already
caught the bugs that Phase 1 v1/v2 fixed.

### C. Visual-regression snapshot tests for the wrappers

Rejected. This codebase deliberately does not maintain Tailwind class
snapshots — they break on every refactor, encourage cargo-culted
"approve the snapshot" reviews, and would force every design tweak
through a snapshot-update PR. Playwright e2e is the right place for
visual regressions if they are ever added.

## References

- `docs/stryker/BASELINE.md` § "Note on `components/ui/*`" — the
  baseline-report passage that explicitly authorises this path.
- `docs/stryker/IMPLEMENTATION_PLAN.md` § 6.2 — original mutate-pattern
  matrix.
- `docs/guidelines/mutation-testing-guidelines.md` § "Classifying a
  surviving mutant" — defines `Wontfix → ADR` as the route for whole
  files / mutator categories that have no protective value.
