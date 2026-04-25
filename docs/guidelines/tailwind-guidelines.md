# Tailwind CSS + shadcn/ui Guidelines

Utility-first styling for `apps/web`.

- **Package**: `tailwindcss` `^4.2.x`, `@tailwindcss/postcss` `^4.2.x`
- **UI primitives**: shadcn/ui on top of Radix UI (copied into `apps/web/components/ui/`)
- **Icons**: `lucide-react` `^1.8.x`
- **Toaster**: `sonner` `^2.0.x`
- **Official docs**: https://tailwindcss.com/docs (v4), https://ui.shadcn.com

---

## When to read this

Before adding a `className`, creating a new component, introducing a color/spacing/radius token, touching `app/globals.css`, or adding a shadcn/ui component.

---

## Tailwind 4 is CSS-first

Tailwind 4 configures from CSS, not `tailwind.config.js`. There is **no** `tailwind.config.js` file in this repo.

```css
/* apps/web/app/globals.css */
@import 'tailwindcss';

@theme {
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;

  --color-bg: hsl(0 0% 100%);
  --color-fg: hsl(222 47% 11%);
  --color-muted: hsl(220 14% 96%);
  --color-border: hsl(214 32% 91%);
  --color-primary: hsl(222 47% 11%);
  --color-primary-fg: hsl(0 0% 98%);
  --color-destructive: hsl(0 72% 51%);

  --radius-sm: 0.375rem;
  --radius: 0.5rem;
  --radius-md: 0.625rem;
  --radius-lg: 0.75rem;
}

@variant dark (&:where([data-theme='dark'], [data-theme='dark'] *));

@layer base {
  :root {
    color-scheme: light;
  }
  [data-theme='dark'] {
    color-scheme: dark;
  }
  body {
    @apply bg-bg text-fg font-sans antialiased;
  }
}
```

Rules:

- **Never introduce a hex color outside `@theme`.** Every color is a token. If a designer hands you a one-off value, add it to `@theme` first.
- **`@theme` keys double as utility names** — `--color-primary` exposes `bg-primary`, `text-primary`, `border-primary`, etc.
- **Dark mode** is data-attribute driven (`data-theme="dark"` on `<html>`). Use `dark:` prefix in components; Tailwind compiles it to the `@variant` above.
- **Arbitrary values** (`text-[#abc]`) are banned for colors; allowed sparingly for layout one-offs (`top-[3.25rem]`) when creating a token is overkill.

---

## Class composition

Compose utilities inline. Use a `cn()` helper for conditional classes:

```tsx
// apps/web/lib/cn.ts
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

```tsx
<button className={cn('rounded-md px-3 py-2 text-sm', isPrimary && 'text-primary-fg bg-primary')} />
```

- **Full class literals** — never `text-${variant}`. Tailwind's JIT does not expand template literals; the class is never generated.
- **`tailwind-merge`** dedupes conflicts (`px-3 px-4` → `px-4`). Essential when a wrapper passes `className` to a primitive that also applies its own padding.
- **Conditional classes via `cn`**, not nested ternaries. Easier to diff.

---

## shadcn/ui

shadcn is not a dependency — components are **copied into this repo** under `apps/web/components/ui/` and are fair game to edit.

Installation pattern (ad-hoc, per component):

```bash
pnpm --filter @nest-auth-example/web dlx shadcn@latest add button dialog input label
```

This writes files like `apps/web/components/ui/button.tsx`. Commit them. You own the code now.

### Rules for shadcn components

1. **Edit in place** when the design system needs tweaks. Don't wrap the primitive in a sibling component just to re-style it.
2. **Do not rename the file** after generation — tooling (future `shadcn diff`) relies on canonical names.
3. Generated components often use Radix-UI primitives. Keep the Radix root/trigger/content hierarchy intact — it's what makes them accessible.
4. Every primitive that accepts `className` merges via `cn` internally. External `className` passed in should always override (enforced by `twMerge`).
5. Prefer shadcn primitives for: buttons, dialogs, dropdowns, popovers, toasts (`sonner` wrapper), tabs, tooltips, forms. Hand-roll only when a specific primitive is missing.

### Composition pattern

```tsx
// apps/web/components/auth/login-form.tsx
'use client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function LoginForm(/* ... */) {
  return (
    <form className="mx-auto flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" />
      </div>
      {/* ... */}
      <Button type="submit">Sign in</Button>
    </form>
  );
}
```

- Compose primitives inside feature folders.
- Do not re-export shadcn primitives from `apps/web/components/` — that would create a parallel blessed API.

---

## Icons

- **`lucide-react`** is the only icon library.
- Prefer **consistent sizes**: `size-4` (16 px), `size-5` (20 px), `size-6` (24 px). Avoid `h-[13px]`.
- **Decorative icons**: `aria-hidden="true"`. **Meaningful icons**: `aria-label` on the icon, or a visible label on the parent button.
- Do not inline SVGs from the web — they bring their own viewBox, fill rules, and sizing quirks.

---

## Spacing, radii, typography scale

Stay on the default Tailwind scale. If a value is not representable as a token, either add a new `@theme` entry or reconsider the design — one-off `[27px]` values are usually a spec error.

- **Radii**: `rounded`, `rounded-md`, `rounded-lg`, `rounded-2xl`. Pick one per component family and stay consistent.
- **Shadows**: `shadow-sm`, `shadow`, `shadow-lg`. Avoid `shadow-xl` or larger on dashboard surfaces — reads as heavy.
- **Font sizes**: `text-xs` through `text-2xl` cover 99% of UI. Bigger values only for marketing pages.

---

## Dark mode

- Toggle by setting `data-theme` on `<html>`. Use a layout component wired to `cookies()` or a `useTheme()` hook.
- Write dark variants for **every surface**: `bg-bg dark:bg-bg-dark` (or model via tokens that auto-switch with the `@variant` above).
- Test every screen in both modes before marking done.

---

## Accessibility

- Tailwind alone does not make a page accessible. Check [react-guidelines.md](react-guidelines.md) for semantic HTML + ARIA rules.
- `sr-only` utility for screen-reader-only labels.
- `focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none` on every interactive element. shadcn primitives include this; custom elements must.
- Minimum touch target 44×44 px on touch surfaces (`min-h-11 min-w-11`). Relevant on mobile web.

---

## PostCSS

```ts
// apps/web/postcss.config.mjs
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- No other PostCSS plugins. Autoprefixer and nesting are built into Tailwind 4.
- Do not add `postcss-nesting` — Tailwind handles CSS nesting natively in v4.

---

## Common pitfalls

1. **Hex colors in JSX** (`style={{ color: '#fff' }}`) — breaks dark mode and theme switching. Use a token + utility.
2. **Template-literal class names** (`bg-${color}`) — JIT skips them, class never ships.
3. **Nested `@apply` in component CSS** — v4 supports it, but utilities are less readable than writing them directly on the element. Avoid unless you're refactoring a legacy component.
4. **Missing `dark:` variant on a new surface** — every color-bearing utility needs its dark counterpart.
5. **Forgetting `tailwind-merge`** — two components each set `px-4` and the wrapper's value silently loses.
6. **Arbitrary values where a token exists** — a drift starts with one `[12px]` and ends with design-debt.
7. **Importing a shadcn component from `node_modules`** — they're copied into the repo; import from `@/components/ui/*`.
8. **Hand-rolling a modal** instead of `Dialog` — you'll miss focus trap, escape to close, scroll lock, aria roles.

---

## References

- Tailwind v4 docs: https://tailwindcss.com/docs
- Tailwind v4 blog: https://tailwindcss.com/blog/tailwindcss-v4
- shadcn/ui: https://ui.shadcn.com
- Radix UI: https://www.radix-ui.com/primitives
- lucide icons: https://lucide.dev
- sonner toasts: https://sonner.emilkowal.ski
