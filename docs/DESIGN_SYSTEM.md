# Bymax Example Apps — Frontend Design Standard

> The implementation contract for the `apps/web` dashboard of every `@bymax-one/*` reference
> application (`nest-config-example`, `nest-core-example`, `nest-auth-example`,
> `nest-logger-example`, `nest-cache-example`, and any future `nest-*-example`).
>
> **Status:** source of truth for implementation. Companion to [`design_system.html`](design_system.html),
> which renders the visual language; this document is what you copy into code, and it records the
> decisions that file leaves open. Where the two differ, §15 says which wins and why.

---

## 0 · How to use this document

The goal is that any two example apps look like **one product**. You are not designing — you are
copying a fixed recipe.

Every app shares exactly five files. Copy them verbatim, then change only the wordmark and the nav
items:

| File                              | What it carries                                                |
| --------------------------------- | -------------------------------------------------------------- |
| `app/globals.css`                 | token block, the `@theme` registration, base resets, keyframes |
| `app/layout.tsx`                  | Geist Sans + Geist Mono variables, forced `dark` on `<html>`   |
| `components/ui/card.tsx`          | the glass card primitive                                       |
| `components/ui/button.tsx`        | the pill button primitive                                      |
| `components/layout/app-shell.tsx` | ambient glow, topbar/sidebar/main composition                  |

Stack, fixed: Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · shadcn/ui `new-york` ·
`geist` fonts · `lucide-react` icons · `sonner` toasts. **No `next-themes`** — dark is forced.

Read §1 before anything else. It is the single most common way these apps break, and the failure is
silent.

---

## 1 · Tailwind v4 setup — read this first

### 1.1 A JavaScript `tailwind.config.ts` does nothing

Tailwind v4 is configured **in CSS**. It does **not** auto-load `tailwind.config.js/ts`; a JS config
is read only when a `@config` directive points at it. A `theme.extend` block sitting in
`tailwind.config.ts` next to a `globals.css` that only says `@import 'tailwindcss'` is **dead code**.

This has silently shipped in more than one example app. The symptom is not a build error — it is
`bg-primary`, `bg-secondary`, `bg-destructive`, `text-muted-foreground`, `ring-ring` and the whole
`brand-*` scale compiling to **nothing**, which leaves every `Button` and `Badge` variant fully
transparent. The app still looks plausible because the hand-written arbitrary values
(`bg-[rgba(255,255,255,0.06)]`) keep working.

**Keep `tailwind.config.ts` reduced to the content globs and nothing else:**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
};

export default config;
```

Do **not** re-add a `theme` block "just in case". It will be ignored and will mislead the next reader.

### 1.2 The `@theme inline` block — copy verbatim

Place this in `app/globals.css`, after the `:root` / `.dark` token blocks and before the base resets.

`inline` is **required**, not stylistic: every semantic color resolves through a `var(--token)` that
`.dark` redefines. `inline` makes each utility emit the `hsl(var(--x))` expression itself, so the
value resolves at the element. Without it the value is frozen at `:root` and the dark overrides are
lost.

```css
@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));

  /* Brand orange scale — the gradient stops the primary Button variant uses. */
  --color-brand: #ff6224;
  --color-brand-50: #fff5f0;
  --color-brand-100: #ffe8d6;
  --color-brand-200: #ffd0ad;
  --color-brand-300: #ffb07d;
  --color-brand-400: #ff8748;
  --color-brand-500: #ff6224;
  --color-brand-600: #e5511b;
  --color-brand-700: #c44113;
  --color-brand-800: #9d320d;
  --color-brand-900: #7a2609;

  /* Binds the body font to the Geist Sans face the root layout loads. */
  --font-sans: var(--font-geist-sans), system-ui, sans-serif;

  /* Drives the shell's ambient glow layers; keyframes are declared further down. */
  --animate-glow-float: glow-float 10s ease-in-out infinite;
  --animate-glow-drift: glow-drift 12s ease-in-out infinite;
}
```

### 1.3 `--font-sans` must be bound explicitly

Tailwind v4 ships its own `--font-sans`. The base rule `font-family: var(--font-sans, …)` therefore
resolves to Tailwind's system stack, and the Geist Sans face the layout loads is **never applied**,
with no warning. The `--font-sans` line in the `@theme` block above is what fixes it.

`--font-mono` needs no equivalent: the `:root` block already redefines it and the `font-mono` utility
picks that up.

### 1.4 ⚠ The `--radius-*` collision

The brand token block defines `--radius-sm/md/lg/xl`. Those names are **Tailwind v4's own radius
namespace**, so they silently rewrite the whole `rounded-*` scale:

| utility       | Tailwind v4 default | with the brand tokens |
| ------------- | ------------------- | --------------------- |
| `rounded-sm`  | 4px                 | **8px**               |
| `rounded-md`  | 6px                 | **12px**              |
| `rounded-lg`  | 8px                 | **16px**              |
| `rounded-xl`  | 12px                | **24px**              |
| `rounded-2xl` | 16px                | 16px (not overridden) |

Note the inversion: **`rounded-xl` (24px) is larger than `rounded-2xl` (16px).**

**Rule:** never rely on a named radius utility for a value that matters. Write an explicit length —
`rounded-[24px]` — and the intent survives a future token change. The named utilities are fine for
small incidental radii (`rounded-lg` on nav items, `rounded-sm` on tree rows) where ±8px is invisible.

### 1.5 PostCSS

```js
const config = { plugins: { '@tailwindcss/postcss': {} } };
```

`@tailwindcss/postcss` only. Tailwind v4 handles vendor prefixing itself; `autoprefixer` is redundant
in the pipeline. (Both audited apps still carry it — harmless, but drop it on the next touch.)

---

## 2 · Color

Primary is orange `#ff6224` = `hsl(20.5 90.2% 57.8%)`. It is both `--primary` and `--ring`.
Surfaces are translucent white over near-black; text is white at descending opacity.

### 2.1 Brand scale

`50 #fff5f0` · `100 #ffe8d6` · `200 #ffd0ad` · `300 #ffb07d` · `400 #ff8748` ·
**`500 #ff6224`** · `600 #e5511b` · `700 #c44113` · `800 #9d320d` · `900 #7a2609`

### 2.2 Semantic

| Role             | Hex       |
| ---------------- | --------- |
| success / info   | `#22c55e` |
| secondary / link | `#60a5fa` |
| warning          | `#f59e0b` |
| error / danger   | `#ef4444` |
| fatal            | `#a855f7` |
| accent           | `#f97316` |

### 2.3 Glass surfaces (the `.dark` set — the only live one)

| Token                | Value                    | Used for                           |
| -------------------- | ------------------------ | ---------------------------------- |
| `--color-bg-primary` | `#0a0a0a`                | page background                    |
| `--glass-bg`         | `rgba(255,255,255,0.05)` | outline button fill, subtle panels |
| `--glass-card-bg`    | `rgba(255,255,255,0.06)` | **card surface**                   |
| `--glass-bg-raised`  | `rgba(255,255,255,0.08)` | chips, raised rows                 |
| `--glass-bg-hover`   | `rgba(255,255,255,0.10)` | hover fill                         |
| `--glass-border`     | `rgba(255,255,255,0.10)` | **card / control border**          |

### 2.4 Text ramp (white opacity)

| Opacity     | Use                      |
| ----------- | ------------------------ |
| `0.9`–`1.0` | headings, metric values  |
| `0.8`       | body emphasis            |
| `0.7`       | body                     |
| `0.6`       | labels                   |
| `0.55`      | inactive nav             |
| `0.5`       | card descriptions        |
| `0.4`       | section labels, dim meta |
| `0.35`      | sidebar group labels     |

**Never encode meaning in color alone.** Pair it with an icon and a text label (see §11).

---

## 3 · Typography

Two families, split by purpose. This split is what gives the apps their observability-tool character.

- **Geist Sans** (`--font-sans`) — prose, descriptions, form labels, button text.
- **Monospace** (`--font-mono`: `ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas,
'DejaVu Sans Mono', monospace`) — headings, brand wordmark, card titles, metric values, config
  paths, env-var names, table data, code.

The base reset already forces `h1`–`h6` to `--font-mono`.

| Element             | Recipe                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Page title (`h1`)   | `font-mono text-2xl font-semibold text-[rgba(255,255,255,0.9)]`                          |
| Page subtitle       | `text-sm text-[rgba(255,255,255,0.5)]`                                                   |
| Card section label  | `font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]` |
| Card content title  | the label above + `normal-case tracking-tight text-[rgba(255,255,255,0.9)]` + a size     |
| Card description    | `text-sm text-[rgba(255,255,255,0.5)]`                                                   |
| Metric value        | `font-mono text-lg text-[rgba(255,255,255,0.9)]`                                         |
| Metric label        | `text-xs font-normal uppercase tracking-wide text-[rgba(255,255,255,0.45)]`              |
| Table header        | `text-xs font-medium uppercase tracking-wider text-[rgba(255,255,255,0.4)]`              |
| Monospace data cell | `font-mono text-sm`                                                                      |

⚠ **A `<button>` inside a `<th>` resets `text-transform`.** The UA stylesheet sets
`text-transform: none` directly on `button`, so a sortable column header renders lowercase next to
its non-sortable neighbours. Repeat `uppercase tracking-wider` on the inner button.

---

## 4 · Space & radius

8-pt rhythm: **4 / 8 / 12 / 16 / 24 / 32**.

**Form fields carry `gap-2` (8px) between label and control, never `gap-1.5`.** Six pixels is off
the rhythm and reads as the label being glued to the input. Two things produce that look together,
so fixing one alone does not help:

- the container gap, and
- the label's line-height — `leading-none` removes the label's own line box, so its descenders sit
  flush on the control below. `Label` sets `leading-snug`; do not override it back.

Field group recipe: `flex flex-col gap-2` (or `space-y-2`) wrapping `<Label>` + control + error.
`CardHeader` / `DialogHeader` keep `space-y-1.5` — a title and its description are one block, not a
label and a control.

**Controls on one row share a height.** A 36px square-cornered `<select>` beside a 48px pill
`<Input>` is the mismatch this rule exists to prevent: pair `h-12 rounded-full px-5` controls with
`size="lg"` buttons.

| Element                                | Radius                                        |
| -------------------------------------- | --------------------------------------------- |
| Cards                                  | `rounded-[24px]` — write the length, see §1.4 |
| Controls (button, badge, chip, avatar) | `rounded-full`                                |
| Nav items, small panels, code blocks   | `rounded-lg`                                  |
| Tree/list rows                         | `rounded-sm`                                  |

---

## 5 · App shell

Fixed 64px topbar · 250px sidebar · fluid main · ambient glow behind everything.

```
<AmbientGlow />                              // fixed inset-0 -z-10
<Topbar />                                   // fixed h-16, z-200
<div className="flex pt-16">
  <Sidebar />                                // 250px, sticky lg:top-16
  {mobileOpen && <backdrop button />}         // z-90, lg:hidden
  <main className="min-w-0 flex-1 px-6 py-8">
    <div className="mx-auto max-w-6xl">{children}</div>
  </main>
</div>
```

Use `max-w-6xl` for data-dense dashboards, `max-w-5xl` for prose-led ones. Pick one per app and keep it.

### 5.1 Ambient glow — required, not decoration

```tsx
<div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
  <div className="absolute -top-32 -left-32 h-[500px] w-[500px] animate-glow-float rounded-full bg-[#ff6224] opacity-15 blur-[120px]" />
  <div className="absolute -top-20 -right-20 h-[400px] w-[400px] animate-glow-drift rounded-full bg-[#60a5fa] opacity-10 blur-[100px]" />
  <div className="absolute bottom-0 left-1/2 h-[300px] w-[300px] -translate-x-1/2 animate-glow-float rounded-full bg-[#f97316] opacity-[0.05] blur-[80px]" />
</div>
```

**Why it is not optional:** `backdrop-blur` over a flat near-black page samples a uniform color and
renders **identically to no blur at all**. Without these layers the glass cards are just a flat 6%
tint and the whole system looks lifeless. The glow is what the blur has to pick up.

Pair it with a reduced-motion guard in `globals.css` — the layers stay visible, only the drift stops:

```css
@media (prefers-reduced-motion: reduce) {
  .animate-glow-float,
  .animate-glow-drift {
    animation: none;
  }
}
```

### 5.2 Topbar

```
fixed left-0 right-0 top-0 z-200 flex h-16 items-center justify-between
border-b border-[rgba(255,255,255,0.07)] bg-[rgba(10,10,10,0.85)] px-4 backdrop-blur-md lg:px-6
```

- Left: brand badge (`h-8 w-8 rounded-lg border border-[rgba(255,98,36,0.4)] bg-[rgba(255,98,36,0.15)]`)
  with a stacked-layers glyph stroked `#ff6224`, plus the wordmark:
  `bg-linear-to-r from-[#ff6224] to-amber-200 bg-clip-text font-mono text-sm font-bold text-transparent`.
- Right: mobile hamburger (`lg:hidden`) + a status chip.
- The brand block needs `min-w-0` and the wordmark `truncate`; the right block needs `shrink-0` and
  its label `whitespace-nowrap`. Otherwise both wrap out of the fixed 64px bar on a narrow viewport.

### 5.3 Sidebar

```
flex w-[250px] shrink-0 flex-col border-r border-[rgba(255,255,255,0.08)] bg-[rgba(12,12,12,0.98)]
z-100 fixed left-0 top-16 h-[calc(100vh-64px)] overflow-y-auto
lg:sticky lg:top-16 lg:h-[calc(100vh-64px)]
```

Nav items:

```
base     flex items-center gap-3 rounded-lg border-l-2 px-3 py-[10px] text-sm transition-all duration-150
active   border-l-[#ff6224] bg-[rgba(255,98,36,0.1)] font-semibold text-[#ff6224]
idle     border-l-transparent font-normal text-[rgba(255,255,255,0.55)]
         hover:bg-[rgba(255,255,255,0.05)] hover:text-[rgba(255,255,255,0.8)]
icon     h-4 w-4 shrink-0   (active #ff6224 · idle rgba(255,255,255,0.4))
```

Grouped navigation:

```
container   flex h-full flex-col gap-7 px-4 py-6
group       flex flex-col gap-1.5
group label px-3 pb-2 font-mono text-[10px] font-semibold uppercase tracking-wide
            text-[rgba(255,255,255,0.35)]
```

⚠ **Carry group separation on the container's `gap`, never on the label's padding.** The label is the
first child of its own group wrapper, so a `first:pt-0` qualifier matches **every** group and
collapses all the spacing. `nest-config-example` shipped exactly that — `pt-4 … first:pt-0` on the
label with `gap-0` on the container — and every group label measured `padding-top: 0px`, which reads
as a cramped sidebar.

### 5.4 Mobile drawer backdrop

Render it as a real `<button type="button" aria-label="Close navigation menu">`, not an
`aria-hidden` div with an `onClick`. A click-handled div is invisible to assistive technology and
leaves no way to dismiss the drawer from the keyboard.

```
z-90 fixed inset-0 bg-black/50 backdrop-blur-sm lg:hidden
```

---

## 6 · Card

The single most-used surface. One recipe, no variants.

```tsx
const ACCENT_LINE_CLASS =
  'bg-linear-to-r pointer-events-none absolute inset-x-0 top-0 h-px from-transparent via-[rgba(255,98,36,0.4)] to-transparent';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.06)] text-card-foreground backdrop-blur-lg',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={ACCENT_LINE_CLASS} />
      {children}
    </div>
  ),
);
```

| Property | Value                                      |
| -------- | ------------------------------------------ |
| radius   | `rounded-[24px]`                           |
| border   | `1px rgba(255,255,255,0.1)`                |
| surface  | `rgba(255,255,255,0.06)`                   |
| blur     | `backdrop-blur-lg` (16px)                  |
| accent   | brand hairline on the top edge, **always** |

**The accent hairline belongs to the `Card`, not to the `CardHeader`.** When it is an opt-in prop on
the header, it appears only where someone remembered to pass it — a measured page in
`nest-core-example` carried it on 6 of its 10 cards, and in `nest-config-example` only 5 of the
components using `Card` opted in at all. Making it structural removes the possibility of drift, and a
card with no header still gets it.

Sub-components:

```
CardHeader   flex flex-col space-y-1.5 p-6 pb-4
CardContent  p-6 pt-0
CardFooter   flex items-center p-6 pt-0
CardTitle    font-mono text-sm font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)]
```

### 6.1 Card titles: section label vs content

`CardTitle`'s default is a **muted uppercase section label** — "CONFIGURATION TREE", "RAW SCRAPE",
"CHECKS". It names the panel; it is not a heading.

When the title is **real content** — a page name, a scenario name, a recipe name, a health-check
name — override the case and color at the call site and add a size:

```tsx
<CardTitle className="text-base tracking-tight text-[rgba(255,255,255,0.9)] normal-case">
  {scenario.title}
</CardTitle>
```

If an app needs this in more than ~3 places, export the override string from `card.tsx` rather than
repeating it:

```ts
export const CARD_TITLE_CONTENT_CLASS = 'normal-case tracking-tight text-[rgba(255,255,255,0.9)]';
```

`normal-case` is what undoes `uppercase` — `tailwind-merge` treats them as the same group, so
appending it works. Adding only a size does **not** remove the uppercase.

⚠ **Where the page title lives inside a card** (some apps wrap the page header in a `Card`), that
title is content, not a section label. Apply the override at `text-xl` or the page reads title-less.

### 6.2 Interactive panels

A clickable tile (a trigger button, a quick link) is a `<button>`, not a `Card`. Match the card
surface so the page stays coherent, but **do not** add the accent hairline — a grid of 18 hairlines
is noise.

```
border-(--glass-border) bg-(--glass-card-bg) hover:bg-(--glass-bg-hover) rounded-[24px] border
```

---

## 7 · Button

Pill shape, brand gradient default.

```
base   inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm
       font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2
       focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none
       disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0
```

| Variant       | Recipe                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `default`     | `bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-sm hover:shadow-(--shadow-primary) hover:scale-[1.02] active:scale-[0.98]` |
| `destructive` | `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90`                                                             |
| `outline`     | `border-(--glass-border) bg-(--glass-bg) hover:bg-(--glass-bg-hover) border text-foreground`                                               |
| `secondary`   | `bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80`                                                                   |
| `ghost`       | `hover:bg-(--glass-bg) hover:text-foreground`                                                                                              |
| `link`        | `text-primary underline-offset-4 hover:underline`                                                                                          |

| Size      | Recipe                             |
| --------- | ---------------------------------- |
| `default` | `h-10 px-6 py-2` (14px text)       |
| `sm`      | `h-8 rounded-full px-4 text-xs`    |
| `lg`      | `h-12 rounded-full px-8 text-base` |
| `icon`    | `h-10 w-10 rounded-full`           |

**Pick one size per app for in-card actions and hold it.** `sm` is the right default for actions
inside a card; `default` for page-level primary actions. Mixed heights in equivalent positions is the
most visible inconsistency an audit finds.

---

## 8 · Badge

```
base   inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold
       transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
```

| Variant       | Recipe                                                          | Use                                   |
| ------------- | --------------------------------------------------------------- | ------------------------------------- |
| `default`     | `border-transparent bg-brand-500 text-white hover:bg-brand-600` | success / affirmative / active filter |
| `destructive` | `border-transparent bg-destructive text-destructive-foreground` | failure                               |
| `secondary`   | `border-transparent bg-secondary text-secondary-foreground`     | neutral code / identifier             |
| `outline`     | `border-(--glass-border) text-foreground`                       | trait / tag / proof chip              |

A filter chip must use `default` when active and `outline` when idle. If §1 is unapplied,
`default`/`destructive`/`secondary` all collapse to transparent-with-transparent-border, and the
active chip ends up with **less** emphasis than the idle ones — the selection state disappears.

---

## 9 · Tables

```
wrapper  relative w-full overflow-auto        // horizontal scroll on mobile — required
table    w-full caption-bottom text-sm
th       h-10 px-4 text-left align-middle text-xs font-medium uppercase tracking-wider
         text-[rgba(255,255,255,0.4)]
tr       border-b border-[rgba(255,255,255,0.06)] transition-colors
         hover:bg-[rgba(255,255,255,0.02)]
```

- Identifiers, paths and env-var names go in `font-mono`; the secondary column dims to
  `text-[rgba(255,255,255,0.6)]`.
- A highlighted row tints with `bg-[rgba(255,98,36,0.06)]`.
- Sortable headers: see the `text-transform` trap in §3. Track direction in state and set
  `aria-sort` to `ascending` / `descending` / `none` — a chevron that implies a toggle must actually
  toggle.

---

## 10 · Code and report blocks

Two distinct treatments; do not mix them up.

**Syntax-highlighted source** — scrolls both axes, never wraps:

```
pre  max-h-[32rem] overflow-auto rounded-lg border border-[rgba(255,255,255,0.1)] bg-black/40 p-4
     font-mono text-xs leading-relaxed
```

Token colors: comment `italic text-[rgba(255,255,255,0.35)]` · string `text-[#ffb37a]` ·
keyword `text-[#7aa2ff]` · plain `text-[rgba(255,255,255,0.8)]`.

**Captured terminal output** — same, plus a decorative scanline overlay and a green-tinted body
(`text-[rgba(190,255,190,0.85)]`).

⚠ **Never use `whitespace-pre-wrap break-words` on either.** Reports arrive pre-formatted in aligned
columns; soft-wrapping destroys the alignment, and it is most visible exactly where it hurts most —
inside a narrow two-column layout. Use `whitespace-pre` and let it scroll.

---

## 11 · Page structure

```tsx
<div className="space-y-6">
  <div>
    <h1 className="font-mono text-2xl font-semibold text-[rgba(255,255,255,0.9)]">Page title</h1>
    <p className="text-sm text-[rgba(255,255,255,0.5)]">
      One sentence saying what this page shows.
    </p>
  </div>

  {/* optional: KPI strip */}
  {/* content cards */}
</div>
```

- Exactly **one `h1` per page**, with a subtitle. Never skip the subtitle.
- Page-level actions sit on the title row:
  `flex flex-wrap items-start justify-between gap-3`.
- Sidebar labels may be shorter than page titles ("Access" → "Access Playground"); that is fine.
- KPI strip: `grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5`. If the tile count does not
  divide evenly at a breakpoint, span the last tile (`max-sm:last:col-span-2`) instead of leaving a
  hole.
- Cards in a grid row need equal heights **and** aligned actions. Equal height alone leaves ragged
  buttons: use `flex h-full flex-col` on the card and `flex flex-1 flex-col justify-between` on the
  content so the action sits on the baseline.
- Two-column comparisons must align row-by-row, not as two independent stacks. Use
  `lg:grid-rows-[auto_auto]` on the grid and `lg:row-span-2 lg:grid-rows-subgrid` on each column.
- When a result panel renders below a long grid, scroll it into view on completion
  (`scrollIntoView({ behavior: 'smooth', block: 'nearest' })`); otherwise the action completes
  off-screen.

---

## 12 · States and copy

| State                     | Treatment                                                            |
| ------------------------- | -------------------------------------------------------------------- |
| Loading (content)         | skeleton, or a short placeholder line — not a spinner                |
| Loading (blocking action) | spinner / disabled button with a present-tense label                 |
| Empty                     | one sentence plus a primary action — never a blank pane              |
| Error                     | `text-sm text-[rgba(255,120,120,0.8)]`, one sentence, no stack trace |

**Copy rules, enforced:**

- Sentence case, ending with a period: `Unable to load the mapping table.`
- Never lowercase fragments (`unable to load the mapping table`). Audits found apps split roughly
  50/50 between the two; pick sentence case everywhere.
- `Loading…` uses a real ellipsis character.
- Error text names the thing that failed, not the mechanism: "Unable to load the annotated tree.",
  not "Request failed with status 500".

---

## 13 · Accessibility

- **Color is never the only signal.** Pair it with an icon and a text label. This applies to severity
  levels, health status, and pass/fail outcomes.
- Every interactive element is a real `<button>` or `<a>`. No `onClick` on a `div`.
- Decorative layers (glow, scanlines, accent hairline) get `aria-hidden="true"` **and**
  `pointer-events-none`.
- Toggle chips carry `aria-pressed`; filter groups carry `role="group"` with an `aria-label`.
- Sortable headers carry `aria-sort`. Nav items carry `aria-current="page"`.
- Infinite animations respect `prefers-reduced-motion`.
- Tables scroll horizontally rather than clipping on mobile.

---

## 14 · Verification checklist

Do not trust the screenshot — the failure mode in §1 looks plausible. Run this in the browser console
against a running app. Every assertion here has caught a real defect.

**Assert on computed styles, not on the stylesheet text.** Two things make CSS-text greps unreliable:
`@theme inline` inlines values, so `--color-brand-500` never appears as a variable (the emitted rule
is `.bg-brand-500 { background-color: #ff6224 }`); and in dev, Turbopack both splits CSS per route
and injects it through `<style>` tags rather than `<link>`, so a class used only on another page is
legitimately absent.

```js
(() => {
  const cards = [...document.querySelectorAll('div')].filter((d) =>
    d.className.includes('rounded-[24px]'),
  );
  const brandBadge = [...document.querySelectorAll('div')].find(
    (d) => d.className.includes('rounded-full') && d.className.includes('bg-brand-500'),
  );
  return {
    // 1 — brand token resolves (must be rgb(255, 98, 36), not rgba(0, 0, 0, 0))
    brandBadgeBg: brandBadge ? getComputedStyle(brandBadge).backgroundColor : 'no brand badge here',
    // 2 — every card carries the accent hairline
    cardCount: cards.length,
    accentOk: cards.every((c) => c.firstElementChild?.getAttribute('aria-hidden') === 'true'),
    // 3 — card surface (expect blur(16px))
    cardBlur: cards[0] && getComputedStyle(cards[0]).backdropFilter,
    // 4 — glow layers present; blur over a flat page is a no-op (expect 3)
    glow: [...document.querySelectorAll('div')].filter((d) =>
      getComputedStyle(d).filter.includes('blur('),
    ).length,
    // 5 — sidebar groups actually separated (expect 28px)
    navGroupGap: [
      ...new Set(
        [...document.querySelectorAll('nav span')].map(
          (s) => getComputedStyle(s.parentElement.parentElement).gap,
        ),
      ),
    ],
    // 6 — no horizontal page overflow
    noOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
  };
})();
```

Run it on a page that has a **primary button** as well, and confirm the gradient:

```js
[...document.querySelectorAll('main button')]
  .map((b) => [b.innerText.trim().slice(0, 24), getComputedStyle(b).backgroundImage.slice(0, 40)])
  .filter(([, bg]) => bg !== 'none'); // must not be empty on a page with a primary action
```

Also check, per app: one `h1` per page with a subtitle; every in-card action button the same height;
`prefers-reduced-motion` stops the glow drift; mobile (375px) topbar stays on one line; tables scroll
instead of clipping at 375px.

---

## 15 · Relationship to `design_system.html`

`design_system.html` is the visual language. This document is the implementation contract and takes
precedence on the points below, all of which were decided during the 2026-07-25 audit of
`nest-config-example` and `nest-core-example`.

| Point           | `design_system.html`                                    | This document                                    | Why                                                             |
| --------------- | ------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Card radius     | `rounded-2xl` (16px); 24px reserved for hero/auth cards | `rounded-[24px]` everywhere                      | Approved after visual review; also immune to the §1.4 collision |
| Card blur       | `backdrop-blur-md`                                      | `backdrop-blur-lg`                               | Approved after visual review                                    |
| Accent hairline | shown on the auth hero card only                        | on **every** card, structural                    | Explicit request; opt-in placement drifted in every audited app |
| Card title      | Mono 16/700 display                                     | muted uppercase section label + content override | Separates "panel name" from "content name"; see §6.1            |
| Page `h1`       | Mono 28/700                                             | `text-2xl` (24px) `font-semibold`                | Matches the shipped apps                                        |
| `autoprefixer`  | "no autoprefixer"                                       | agreed — drop it                                 | Redundant under v4                                              |

**Open, not yet applied anywhere:** `design_system.html` also prescribes
`@custom-variant dark (&:is(.dark *))`. No audited app declares it. It is only needed once an app
uses `dark:` utilities — none do today, because dark is forced and the `.dark` block is plain CSS.
Add it before introducing the first `dark:` utility.

---

## 16 · Anti-patterns

Each of these was found in a shipped app.

1. **A `theme.extend` in `tailwind.config.ts` under Tailwind v4.** Dead code that reads as
   configuration. See §1.1.
2. **Naming a token after a Tailwind namespace** (`--radius-xl`). Silently rewrites a whole utility
   scale. See §1.4.
3. **`backdrop-blur` with nothing behind it.** A blur over a flat background is a no-op; ship the
   glow layers or drop the blur claim.
4. **An opt-in `accent` prop for a mark that every card should have.** Guarantees drift.
5. **`first:`-qualified padding on an element that is always first.** Matches everything, applies
   nowhere. See §5.3.
6. **`whitespace-pre-wrap` on pre-formatted report output.** Destroys column alignment. See §10.
7. **A clickable `aria-hidden` div.** Unreachable by keyboard and screen reader. See §5.4.
8. **A chevron implying a sort direction the code does not toggle.** See §9.
9. **Mixed button heights in equivalent positions.** See §7.
10. **Mixed empty-state copy casing.** See §12.
