# Mutation Testing Guidelines

## Purpose

Mutation testing measures **test strength**, not test coverage.

Line/branch/function/statement coverage at 100% proves that every line of
production code was _executed_ by the test suite. It does not prove that the
assertions inside those tests would _catch a regression_. A test that calls
`userService.create(...)` without asserting on the returned object still
counts toward 100% coverage but would happily pass after someone deleted the
function body.

[Stryker](https://stryker-mutator.io) addresses this by **mutating** the
source code (`+` → `-`, `<` → `<=`, `true` → `false`, removes `return`,
swaps method calls, etc.) and re-running the test suite for each mutant:

- If a test **fails** → the mutant is **killed** (good).
- If all tests **still pass** → the mutant **survived** (a real gap).

Mutation score = `killed / total mutants`. Pair it with the existing 100%
line coverage to get an honest signal for the suite's quality.

## When to run it

Run the mutation suite when you touch:

- `apps/api/src/**/*.service.ts`, `*.controller.ts`, `*.guard.ts`,
  `*.filter.ts`, `*.provider.ts`, `*.hooks.ts`, `*.config.ts`.
- `apps/web/lib/**/*.ts`.
- `apps/web/components/**/*.tsx` and `*.ts`.

Do **not** run it (and do not configure it to mutate):

- `*.module.ts` — pure DI metadata.
- `*.dto.ts` — class-validator decorators.
- `apps/api/src/main.ts` — bootstrap, covered by e2e.
- `apps/web/app/**` — Next.js pages/layouts/route handlers, covered by Playwright.
- `**/index.ts` — barrels.
- `**/*.d.ts` — type-only.
- `**/test/**`, `**/*.spec.ts`, `**/*.test.ts(x)` — the tests themselves.

See the matrix in [`docs/stryker/IMPLEMENTATION_PLAN.md` §6](../stryker/IMPLEMENTATION_PLAN.md) for the full inclusion/exclusion logic.

## Commands

```bash
# Full run (both workspaces)
pnpm mutation

# Per-workspace full run
pnpm mutation:api
pnpm mutation:web

# Incremental — only re-tests mutants impacted by the working-tree diff.
# Much faster (~10×) during the local kill loop.
pnpm mutation:incremental
pnpm mutation:incremental:api
pnpm mutation:incremental:web

# Validate the config without executing mutants. Use after editing
# stryker.config.json or upgrading any Stryker package.
pnpm mutation:dry-run
```

A full first run on a clean cache takes ~5–15 min per workspace on a modern
laptop with `concurrency: 4`. Incremental runs are typically under 90 s.

## Reading the HTML report

After every run:

- API report → `apps/api/reports/mutation/api.html`
- Web report → `apps/web/reports/mutation/web.html`

Open in a browser. The top banner shows the global mutation score and a
colour band:

- **Green** — at or above the `high` threshold (95%).
- **Yellow** — between `low` (85%) and `high`.
- **Red** — below `low`.

Drill into a folder, then into a file. The file viewer renders the source
with each mutant overlaid. Filter the list by status:

- `Killed` — at least one test failed → no action needed.
- `Survived` — every test passed → **triage required**.
- `NoCoverage` — no test even ran this code → either add a test or exclude
  the file from `mutate` with an ADR.
- `Timeout` — tests took longer than `timeoutMS` → almost always an
  infinite loop introduced by the mutant; counts as killed.
- `CompileError` — TypeScript checker rejected the mutant → counts as
  killed.
- `RuntimeError` — mutant threw before the test ran → counts as killed.

## Classifying a surviving mutant

For each surviving mutant, pick exactly one of three classes:

### 1. Real gap → add a test

The mutation changed behaviour and your test suite did not detect it. The
test that _should have_ failed is missing an assertion (or missing
altogether).

**Fix**: write a test that asserts on the precise behaviour the mutant
changes. Examples:

- Mutant swaps `<` for `<=` → add a test that exercises the **boundary**
  (`length === 0`, `value === limit`).
- Mutant flips `return true` to `return false` → add a test that asserts on
  the truthy return path, not just on "no error was thrown".
- Mutant removes `await` → add a test that observes the side-effect
  ordering, not just the eventual result.
- Mutant changes `throw new ConflictException(...)` to a no-op → add a test
  that asserts on the exact error code and message.

Always assert on the **observable contract** (return value, thrown error
code, audit-log row, cookie set, WebSocket frame emitted), not on the
implementation detail ("function `_internalHelper` was called").

### 2. Equivalent mutant → disable with a reason

The mutated code is **semantically identical** to the original. No test can
ever kill it. Common patterns in this repo:

- `>= 0` vs `> -1` on `Array.length` — length is always `≥ 0`.
- `if (value === undefined)` vs `if (value == null)` after a Zod parse that
  guarantees `undefined`.
- A no-op fallback branch in a defensive guard whose precondition is
  enforced earlier in the same closure.
- A condition spread under `exactOptionalPropertyTypes` that produces the
  same final object either way.

**Fix**: add an inline disable comment with the **mutator name** and a
**specific reason**:

```ts
// Stryker disable next-line EqualityOperator: length cannot be negative; `>= 0` and `> -1` are equivalent
if (items.length >= 0) { ... }
```

### 3. Wontfix → ADR + `excludedMutations` (very rare)

A whole category of mutants is meaningless for this codebase (e.g.,
`StringLiteral` mutants inside log message templates that never affect
behaviour). Disabling the category project-wide is a non-trivial decision.

**Fix**: open an ADR in `docs/decisions/` justifying the exclusion, then
add the mutator name to `excludedMutations` in the appropriate
`stryker.config.json`.

## Disable comments — strict rules

Disable comments are linted by `/bymax-quality:code-review`. A PR that
violates any of these rules is rejected.

- **Always** use `next-line` (`// Stryker disable next-line ...`).
  Never file-wide (`// Stryker disable all`).
- **Always** name the mutator (`EqualityOperator`, `BooleanLiteral`,
  `ArithmeticOperator`, `ConditionalExpression`, `StringLiteral`,
  `ArrayDeclaration`, `ObjectLiteral`, `LogicalOperator`,
  `UpdateOperator`, `MethodExpression`, `BlockStatement`,
  `OptionalChaining`, `Regex`). Never `all`.
- **Always** include a colon-prefixed reason that explains _why_ the
  mutant is equivalent. The reason appears in the HTML report and is the
  primary signal a reviewer uses.
- **Never** disable a mutant just to "make the score green". If you
  cannot articulate why the mutant is equivalent, it is a real gap —
  write the test instead.

Bad:

```ts
// Stryker disable next-line all
return items.length >= 0;
```

Good:

```ts
// Stryker disable next-line EqualityOperator: length is non-negative, `>= 0` and `> -1` are equivalent
return items.length >= 0;
```

## Common mutators and how to kill them

| Mutator                 | What it changes                           | How to kill                                                                  |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `ArithmeticOperator`    | `+` ↔ `-`, `*` ↔ `/`, etc.                | Assert on the **exact numerical result**, not "result is > 0"                |
| `EqualityOperator`      | `<` ↔ `<=`, `>` ↔ `>=`, `==` ↔ `!=`       | Test the **boundary** value, not just "above" and "below"                    |
| `BooleanLiteral`        | `true` ↔ `false`                          | Assert on the **return value**, not "no error thrown"                        |
| `ConditionalExpression` | `if (x)` → `if (true)` / `if (false)`     | Test both branches **and** the condition's negation                          |
| `LogicalOperator`       | `&&` ↔ `\|\|`                             | Test all 4 combinations of the operands                                      |
| `StringLiteral`         | `'foo'` → `""`                            | Assert on the **exact string** when it affects behaviour (error codes, URLs) |
| `ArrayDeclaration`      | `[a, b]` → `[]`                           | Assert on **array length** _and_ **each element**                            |
| `ObjectLiteral`         | `{ a: 1 }` → `{}`                         | Assert on each **expected key**, not just that the object is truthy          |
| `MethodExpression`      | `arr.filter(...)` → `arr.slice(...)` etc. | Assert on the **resulting collection**, not just "method was called"         |
| `BlockStatement`        | Empties a `{ ... }` block                 | Assert on the **side-effect** that block produces                            |
| `OptionalChaining`      | `a?.b` → `a.b`                            | Test with `a === undefined` and `a === null`                                 |

## Equivalent mutants — known patterns in this repo

Captured during Phase 1 (web). Each entry pairs a mutation Stryker reports
as surviving with the structural reason no test can kill it without
adopting a snapshot regime, and with the disable-directive recipe that
documents the equivalence in source.

### Defensive null/undefined guards downstream of a stricter check

`urlSlug !== null` in `resolveDefaultTenantSlug` (`apps/web/lib/tenants.ts`)
sits in front of a `.some(...)` predicate whose comparator already rejects
null values. Dropping the explicit null check produces an
observationally-identical program. Same shape: `user?.tenantId` in
`tenant-switcher.tsx` when the surrounding render only mounts the
dropdown once `activeWorkspace` is defined.

Disable on the line itself:

```ts
// Stryker disable next-line ConditionalExpression: …
if (urlSlug !== null && TENANT_OPTIONS.some((opt) => opt.value === urlSlug)) { … }
```

### Optional-chain on out-of-range indices a sibling guard already prevents

`inputRefs.current[index]?.focus()` in `otp-input.tsx` is gated upstream
by `index < length - 1` / `index > 0`. The `?.` cannot fire on an
undefined slot under any user-reachable flow. Disable with a reason
that names BOTH the optional chain AND the upstream guard.

### Mutually-redundant if-guard arms

`!isFormOpen && counterTone !== null && remaining !== undefined && total !== undefined`
in `mfa-disable-card.tsx` carries three clauses where `counterTone` is
derived from `remaining`. Mutating either of those two to `true` leaves
the other catching the same failure mode. Extract the whole guard into
a single named local on its own line so a single directive lands:

```ts
// Stryker disable next-line ConditionalExpression
const isCounterVisible =
  !isFormOpen && counterTone !== null && remaining !== undefined && total !== undefined;
```

### Equivalent literals in TypeScript-rejected mutations

`setMode('regenerating') → setMode('')` is observationally equivalent
because `''` is not `'idle'`, so `isFormOpen` stays true and the
non-`'disabling'` branches of every downstream ternary fall through
identically. TypeScript would reject the empty string at compile time,
but Stryker does not run the project's TS check on `apps/web` — disable
on the line itself with the TypeScript rationale.

### shadcn Button `variant=""` falls back to default

`mode === 'disabling' ? 'destructive' : 'default'` — mutating `'default'`
to `""` passes an empty string to the shadcn Button `variant` prop. The
CVA map has no entry for `""`, so the rendered classes are identical to
the default variant. Pair the disable with a kill test that asserts on
the unique brand-gradient class (`from-brand-500`) for the truthy branch.

### `padEnd('')`/`padStart('')` with an empty padder

`value.padEnd(length, '')` and `value.padStart(length, '')` both return
the original string verbatim because the spec defines no growth with an
empty padder. The trailing `.slice(0, length)` then caps both outputs
the same way. Disable the MethodExpression directly.

### Redundant pre-cap / trailing-cap slices

`pasted.padEnd(length, …)` after a leading `slice(0, length)` cannot
exceed `length`, so the trailing `.slice(0, length)` is belt-and-
suspenders. Split into a named local so the disable lands on just the
trailing cap.

### useEffect `cancelled` flag race

`if (!cancelled) setStatus(…)` is observable in production as a React
"state update on an unmounted component" warning. JSDOM + Vitest demote
that warning to a non-fatal console message, which Stryker cannot use as
a kill signal. Wrap the cleanup with `Stryker disable
BlockStatement,BooleanLiteral,ConditionalExpression … Stryker restore
…` and reference the higher-level "still hides counter" tests.

### React Hook Form config strings

`mode: 'onSubmit'` / `reValidateMode: 'onChange'` — mutating to `""`
falls back to RHF's default `onSubmit`. Other valid values produce
working forms with valid alternative timing. Impossible to pin without
coupling tests to RHF internals.

### Modal `?? []` fallback when the modal is closed

`<RecoveryCodesModal open={freshCodes !== null} codes={freshCodes ?? []} />`
— the `?? []` fallback only fires when `freshCodes === null`, in which
case `open={false}` ensures the modal renders nothing. Mutating to
`?? ["Stryker"]` cannot leak through a closed modal.

### `formatDistanceToNow({ addSuffix: true })`

The ObjectLiteral `{}` mutant + BooleanLiteral `true → false` are both
killed by asserting the rendered text contains ` ago` somewhere in the
row.

### Per-row id selectors when the test fixture has one toggled row

`prev.map((u) => (u.id === user.id ? { ...u, status: newStatus } : u))`
in optimistic update / server-confirm / rollback paths — Vitest's
synchronous render model collapses the intermediate-state
observability between "update one row" and "update all rows" when the
test fixture has only one toggled row. Disable with a reason that
names the fixture limitation and points at the post-resolve final-state
assertions.

### JSDOM `clipboardData.getData(format)` ignores the format argument

`getData('text')` vs `getData('')` returns the same value in JSDOM
because the test mock ignores the format argument. In a real browser
`''` would fail to match the registered MIME type; the unit suite
cannot distinguish.

## Disable-directive placement — Stryker AST quirks

These are NOT obvious from the Stryker docs. Burn-in pattern discovered
during Phase 1 web hardening.

1. **`Stryker disable next-line <Mutator>` only suppresses mutants whose
   AST node STARTS on the next line.** When the parent expression spans
   multiple lines (chained `else if`, multi-line JSX, useEffect `},
[deps])` with deps on the closing line), Stryker attributes the
   mutant to the parent statement's start line — not the line where the
   token visually lives. The directive on the line above the token
   silently does nothing. Two workarounds:
   - Extract sub-expressions into named locals on a single line:
     `const canMoveLeft = index > 0;` then `// Stryker disable
next-line EqualityOperator,ConditionalExpression` above it.
   - Extract deps arrays to module-level or in-component locals:
     `const EMPTY_EFFECT_DEPS: readonly never[] = [];` then
     `useEffect(() => { … }, EMPTY_EFFECT_DEPS);`. The directive lands
     on the const declaration line where the ArrayDeclaration AST node
     starts.

2. **JSX comments (`{/* Stryker disable … */}`) are NOT parsed as
   Stryker directives.** Only plain JS comments (`//` / `/* */`) work.
   When the disable target sits inside JSX, refactor so the directive
   can live in a JS context: extract a ternary or className composition
   into a named const above the `return (…)` statement.

3. **`BlockStatement` mutants on `try/finally` resist both `next-line`
   and bracketed `Stryker disable BlockStatement … Stryker restore
BlockStatement` forms** when the directive sits in the surrounding
   catch arm or after the closing brace. The cleanest fix is to skip
   the disable and write a real kill test that asserts on the
   post-resolve UI state (button re-enabled, label restored, etc.).
   The "Loading…" / "Verifying…" disappears after the rejection settles
   pattern works well.

4. **Block-form `Stryker disable Foo / Stryker restore Foo` only covers
   AST nodes whose start position falls between the two directives.**
   For multi-line `useCallback`/`useEffect` calls, the parent call
   starts above the block — wrap the whole call in the block or use
   the named-locals refactor above.

5. **Tooling note: there is no per-file `excludedMutations`.** That
   option is project-wide. To exclude a single file from mutation
   testing, add it to `mutate` as a negation glob (`!components/ui/…`),
   document the rationale in ADR 0001, and verify line coverage stays
   at 100 % via the unit suite.

6. **Long Tailwind className strings inside `cn(...)` / JSX attributes
   need the constant-extraction refactor.** Stryker attributes every
   StringLiteral mutant inside a `cn('foo', 'bar')` call to the parent
   JSX attribute's start line, so no per-line directive can reach them.
   The fix is to hoist the strings into module-level `const` declarations
   and wrap them in a `// Stryker disable StringLiteral` /
   `// Stryker restore StringLiteral` block. Pattern:

   ```ts
   // Stryker disable StringLiteral
   const ITEM_BASE_CLASSES = [
     'relative flex cursor-default …',
     'focus:bg-(--glass-bg-hover) …',
   ] as const;
   const LABEL_CLASS = 'px-2 py-1.5 text-xs …';
   // Stryker restore StringLiteral

   // INSET_CLASS lives OUTSIDE the block — its mutant IS killable by the
   // `expect(el.className).toContain('pl-8')` test, so it stays in scope.
   const INSET_CLASS = 'pl-8';
   ```

   Then in the JSX:

   ```tsx
   <DropdownMenuPrimitive.Item
     className={cn(...ITEM_BASE_CLASSES, inset && INSET_CLASS, className)}
   />
   ```

   This pattern is the **default playbook** for any shadcn wrapper that
   has BOTH behavioural surface worth pinning (disqualifies it from ADR
   0001 exclusion) AND long Tailwind strings inside `cn(...)` /
   attributes (disqualifies it from "just add per-line directives").
   `apps/web/components/ui/dropdown-menu.tsx` is the reference
   implementation.

## The count-only-trap on boolean-toggle JSX conditionals

**Symptom:** a `getAllByText(X).toHaveLength(1)` assertion passes for
both the original `condition && <span>X</span>` and its `||` mutant —
the LogicalOperator survives.

**Why:** under React's JSX evaluation, swapping `&&` for `||` flips
which row owns the element, but the total count stays the same.

| Code                                     | `isCurrent=true` (row 1)   | `isCurrent=false` (row 2)  | Total `<span>X</span>` |
| ---------------------------------------- | -------------------------- | -------------------------- | ---------------------- |
| `isCurrent && <span>X</span>` (original) | `<span>X</span>` → renders | `false` → skipped          | **1**                  |
| `isCurrent \|\| <span>X</span>` (mutant) | `true` → skipped           | `<span>X</span>` → renders | **1**                  |

The `<span>` ends up on a different row, but the count assertion
cannot tell.

**Fix:** pin the OWNER row, not the global count. Use
`closest('row-scope-element').textContent` (or a row-scoped
`within(...)`) to assert WHICH row contains the element AND that the
other row does NOT.

```ts
// Bad — survives the && → || mutant.
expect(screen.getAllByText('Current')).toHaveLength(1);

// Good — kills the mutant by pinning the owner row.
const chromeCell = screen.getByText('Chrome on macOS').closest('div');
expect(chromeCell?.textContent ?? '').toContain('Current');
const firefoxCell = screen.getByText('Firefox on Windows').closest('div');
expect(firefoxCell?.textContent ?? '').not.toContain('Current');
```

This applies to any `condition && <X />` where the JSX produces a
non-trivial truthy renderable. Multi-row badges, per-item action
buttons, per-row icons — all need owner-row assertions.

## The Radix AlertDialog teardown trap on `finally`-block kill tests

**Symptom:** A test that asserts a delete trigger button is re-enabled
after the dialog action runs throws `Unable to find role="button"` —
even though the trigger is in the DOM and the `finally` block has cleared
the `deleting` state.

**Why:** After `AlertDialogAction` is clicked, Radix tears the overlay
down asynchronously and leaves `<body data-aria-hidden="true">` for
several microtasks. Testing-library role queries
(`screen.getByRole`, `getAllByRole`) ignore aria-hidden subtrees by
default, so the trigger button becomes unreachable through the role API
until the teardown settles. The mutation that needs killing — the empty
`finally` block — is masked by an entirely unrelated framework artefact.

**Fix:** query via a raw DOM selector that ignores aria-hidden, or use a
trigger reference captured BEFORE the dialog opened.

```ts
// Raw DOM selector — survives Radix teardown.
const alphaTrigger = document.querySelector<HTMLButtonElement>(
  'button[aria-label="Delete project Alpha Project"]',
);
expect(alphaTrigger).not.toBeNull();
expect(alphaTrigger?.disabled).toBe(false);
```

```ts
// Captured ref before dialog open — also survives teardown.
const triggers = screen.getAllByRole('button', { name: /^Delete project /i });
const alphaTrigger = triggers[0]!;
fireEvent.click(alphaTrigger);
// …click action, await deleteProject…
await waitFor(() => expect((alphaTrigger as HTMLButtonElement).disabled).toBe(true));
```

**Bonus:** prefer the **failure path** (where `load()` does NOT re-run
after the dialog action) over the success path for `finally`-block kills.
The failure path leaves the row in place so the trigger reference stays
attached and the assertion is robust against both the Radix teardown
trap AND the post-success row remount.

## The effect-cleanup-masks-the-branch trap

**Symptom:** the mutation report lists multiple unrelated mutators
(BlockStatement, ConditionalExpression, EqualityOperator, StringLiteral)
all surviving on the same `if (…) { … }` block inside a `useEffect` that
ALSO returns a cleanup function. The existing test calls
`expect(fn).toHaveBeenCalledWith(args)` and passes.

**Why:** React runs the previous effect's cleanup before re-running the
effect body. When both the cleanup and a re-run branch call the same
teardown (`off`, `unsubscribe`, `disconnect`) with the same arguments,
the cleanup alone accounts for the matching call. An empty-block or
flipped-condition mutant on the inner branch leaves the cleanup intact
and the assertion still passes.

**Fix:** count the calls. With the original code the teardown runs
TWICE (cleanup + inner branch). With any mutant on the inner branch it
runs ONCE.

```ts
expect(ws.off).toHaveBeenCalledTimes(2);
expect(ws.off).toHaveBeenNthCalledWith(1, 'notification:new', handler);
expect(ws.off).toHaveBeenNthCalledWith(2, 'notification:new', handler);
```

**Paired guard for the always-true ConditionalExpression mutant:**
render the component once in the "ref still null" state (no prior
subscription) and assert the teardown is NOT called. An always-true
mutant would enter the inner branch with a null ref and trigger the
side effect.

```ts
// First-render-unauthenticated: handler ref is null, so the inner
// branch must NOT call ws.off. An always-true mutant would call it.
render(<NotificationListener />);
expect(ws.off).not.toHaveBeenCalled();
```

Applies to any `useEffect` whose cleanup AND a re-run branch both call
the same teardown — subscription listeners, observer wiring, idempotent
connection guards.

## The HTMLInputElement.type normalisation trap

**Symptom:** the StringLiteral mutant on the truthy arm of
`type={isVisible ? 'text' : 'password'}` survives even though the test
asserts the input type changed after the toggle was clicked.

**Why:** browsers and JSDOM normalise unknown or empty input `type`
attributes to `'text'` (the HTMLInputElement default). When Stryker
replaces `'text'` with `''`, the React tree renders `<input type="">`
and the property `input.type` still reports `'text'` — the assertion
passes for both shapes.

The falsy arm `'password'` is NOT affected by the same trap: empty
normalises to `'text'`, not `'password'`, so
`expect(input.type).toBe('password')` already kills the falsy-arm
mutant.

**Fix:** for the truthy arm, assert on the raw attribute via
`getAttribute('type')`, which returns the verbatim source value.

```ts
// Bad — passes for both `type="text"` AND `type=""`.
expect(inputEl.type).toBe('text');

// Good — kills the StringLiteral `'text'` → `''` mutant.
expect(inputEl.getAttribute('type')).toBe('text');
```

The same principle applies to any HTMLInputElement attribute whose
property reflection normalises (`type`, `value` for number inputs,
`min` / `max` / `step` etc.). When the test is killing a mutation on a
string literal that ends up in a normalised attribute, prefer
`getAttribute()`.

## Math.random and timing mocks — always pair two values

A `vi.spyOn(Math, 'random').mockReturnValue(0.5)` collapses the jitter
factor `0.8 + 0.5 * 0.4` to `1.0`, the multiplicative identity. Every
ArithmeticOperator mutant on the surrounding expression
(`base * factor` ↔ `base / factor`, `+` ↔ `-`) becomes a no-op and
survives.

**Fix:** pick a default value that breaks symmetry, and add a paired
test with a second value. The two assertions together lock both the
magnitude and the sign.

```ts
// Default beforeEach — jitter factor 0.8 → 800 ms first reconnect.
vi.spyOn(Math, 'random').mockReturnValue(0);

// Paired test inside the describe — jitter factor 1.2 → 1200 ms first reconnect.
// Together with the 800 ms assertion, kills:
//  - `+` → `-` (would give 400 vs 800 in the jitter sum),
//  - `*` → `/` on the base factor (would give 1250 vs 800),
//  - `*` → `/` on `Math.random() * 0.4` (would give 3300 vs 1200).
vi.spyOn(Math, 'random').mockReturnValue(1);
```

Applies to any randomness mock used in arithmetic — exponential
backoff, jittered retries, non-deterministic IDs. One value is never
enough.

## Side-effect spies for guards with downstream no-op safety nets

A conditional like `if (timer !== null) clearTimeout(timer)` survives
mutations to `if (true)`, `if (false)`, `!==` → `===`, and the
BlockStatement empty body whenever a downstream layer ALSO no-ops on
the same condition. `clearTimeout(null)` is a valid no-op; the timer
fires `connect()` which itself early-returns on `stopped=true`. Every
mutant reaches the same symptom-level "no new socket opens" outcome.

**Fix:** spy on the side effect directly. Assert it was called the
expected number of times, AND add a paired guard that asserts it was
NOT called on the falsy branch.

```ts
const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
// … arm the timer, then close() …
expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

// Paired guard — must NOT be called when no timer is armed.
const ws = getWsClient();
clearTimeoutSpy.mockClear();
ws.close();
expect(clearTimeoutSpy).not.toHaveBeenCalled();
```

Same pattern applies to `setTimeout`, `socket.close()`, lifecycle-handler
nulling (`socket.onopen = null`), `clearInterval`, `dispose()` etc.
When the test can't observe the symptom, observe the side effect.

## Block-form disables for multi-line OR / AND chains

`// Stryker disable next-line` only catches mutants whose AST node
starts on the immediately following line. A multi-line OR-chain inside
an `if (…)` distributes its clauses across multiple AST nodes — the
directive on the parent statement does NOT reach the inner clauses.

**Fix:** hoist the chain into a named local (matching `cond` ↔ `if`
Rule 1) AND wrap the assignment with a `// Stryker disable …` /
`// Stryker restore …` block. The block form catches every mutator
in the wrapped scope.

```ts
// Stryker disable ConditionalExpression,LogicalOperator: <rationale>
const isMalformedNotification =
  eventName === 'notification:new' &&
  (typeof data !== 'object' ||
    data === null ||
    typeof (data as Record<string, unknown>)['title'] !== 'string' ||
    typeof (data as Record<string, unknown>)['body'] !== 'string');
// Stryker restore ConditionalExpression,LogicalOperator
if (isMalformedNotification) return;
```

Use this only when the expression is GENUINELY equivalent (per the
catalogue) AND spans multiple lines. The named local also makes the
guard easier to read.

## Anti-patterns that look like equivalent mutants but aren't

- **Toast message text** — always pin verbatim. Support docs, audit
  dashboards, and QA matchers pattern-match on these strings.
- **Tailwind palette class fragments on tone branches** — pin one
  unique class per branch (`text-red-300` for critical,
  `text-amber-300` for warning, etc.). Only the muted/default arm of a
  className ternary qualifies as visual-equivalent and warrants a
  disable directive.
- **`finally { setIsLoading(false) }` cleanup** — looks equivalent in
  passing-suite runs but always kill via the retry-after-error
  assertion.
- **Mode-machine `setMode('idle')` after success** — looks equivalent
  but the falsy-arm test (idle button returns, form gone) is straight-
  forward to add.

## CI integration

A dedicated GitHub Actions workflow (`.github/workflows/mutation.yml`) runs
the mutation suite on:

- Every push to `main`.
- Pull requests that carry the `run-mutation` label.

The workflow caches `reports/stryker-incremental.json` per branch so reruns
are fast. HTML reports are uploaded as artefacts and kept for 14 days.

CI does **not** gate PRs on mutation score during **Phase 0**. From
**Phase 2** onward the `break` threshold (currently `null` → `80` →
`90` → `95` across the phases described in
[`docs/stryker/IMPLEMENTATION_PLAN.md`](../stryker/IMPLEMENTATION_PLAN.md))
will fail the workflow when score drops below it.

## See also

- [docs/stryker/IMPLEMENTATION_PLAN.md](../stryker/IMPLEMENTATION_PLAN.md) — the full multi-phase rollout plan.
- [docs/stryker/BASELINE.md](../stryker/BASELINE.md) — initial mutation scores per workspace.
- [Stryker JS configuration reference](https://stryker-mutator.io/docs/stryker-js/configuration/).
- [Disabling mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/).
- [Jest runner](https://stryker-mutator.io/docs/stryker-js/jest-runner/) / [Vitest runner](https://stryker-mutator.io/docs/stryker-js/vitest-runner/).
