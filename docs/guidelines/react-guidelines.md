# React Guidelines

React 19 component patterns for `apps/web` on top of Next.js 16.

- **Package**: `react` `^19.2.x`, `react-dom` `^19.2.x`
- **TypeScript**: strict (see [typescript-guidelines.md](typescript-guidelines.md))
- **Official docs**: https://react.dev

---

## When to read this

Before creating or modifying any `.tsx` file that exports a component, hook, or context. Next.js App Router specifics live in [nextjs-guidelines.md](nextjs-guidelines.md).

---

## Component style

Function components only. `export function` over `export default function` — named exports keep refactors and Grep cleaner.

```tsx
type Props = {
  email: string;
  onSubmit: (email: string) => void;
};

export function LoginForm({ email, onSubmit }: Props) {
  // ...
}
```

Rules:

- **No default exports** for components. `export function Foo()` at the top, `export type FooProps` next to it.
- **One component per file** when the component exceeds ~30 lines or owns its own state. Small sub-components in the same file are fine when they're truly private.
- **Props are typed with a `type` (not `interface`)** — `interface` merges unexpectedly across imports. Use `type` by default.
- **No `React.FC`.** It adds implicit children, widens the type, and is widely considered an anti-pattern.

---

## Hooks

Standard rules still apply: top-level only, same order every render, names start with `use`.

- **Own hooks**: `useXxx` in `apps/web/hooks/` or `apps/web/app/<feature>/_hooks/` for feature-local ones. Prefix with the feature when the name is generic (`useAuthFormState`, not `useFormState`).
- **Library hooks** (`useSession`, `useAuth`, `useAuthStatus`) come from `@bymax-one/nest-auth/react` — do not wrap them.
- **Effect rules**:
  - No network calls inside `useEffect` in this project. Either it runs at render (Server Component fetch) or it runs from an event handler.
  - No state sync between two `useState` calls inside `useEffect`; derive during render.
  - Cleanup every subscription, observer, timer, or event listener.

### React 19 additions we use

- **`use(promise)` and `use(context)`** — inside Server Components you can `use()` a promise to suspend. Keep these at leaves, not in the root layout.
- **Actions & `useActionState`** — optional; we use them where it cuts boilerplate around forms (see [forms-guidelines.md](forms-guidelines.md)).
- **`useOptimistic`** — for immediate UI updates that reconcile on server response (e.g., toggle a session row state before confirm).
- **`ref` as a prop** — React 19 treats `ref` as a regular prop. No more `forwardRef` for simple passthroughs.

---

## Client vs server boundary

Covered in [nextjs-guidelines.md](nextjs-guidelines.md). React-specific reminders:

- `useState`, `useReducer`, `useEffect`, `useMemo`, `useRef`, `useId`, `useContext`, `useSyncExternalStore` — client only. A file using any of them needs `'use client'`.
- Server Components can be `async`; client components cannot. A prop that resolves to JSX can bridge the gap (render-prop pattern with a server component as the renderer).

---

## State management

- **Local state** via `useState` / `useReducer`. That is the default.
- **Cross-component state** through **context** + a local provider at the feature root. No external state libraries (Zustand, Redux, Jotai) in this project.
- **Auth + session state** flows exclusively through `<AuthProvider>` and the library hooks. Adding a parallel "currentUser" context is banned.
- **Forms** own their state via React Hook Form (see [forms-guidelines.md](forms-guidelines.md)).
- **URL state** (filters, pagination) lives in `searchParams`. Read from the server component, pass down as props.

---

## Context

```tsx
type ThemeValue = { theme: 'light' | 'dark' };
const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({
  theme,
  children,
}: {
  theme: ThemeValue['theme'];
  children: ReactNode;
}) {
  return <ThemeContext.Provider value={{ theme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside <ThemeProvider>');
  return v;
}
```

Rules:

- Always initialize context to `null` and throw in the hook when absent — a default value hides missing providers.
- Memoize the `value` object (`useMemo`) when it contains fresh references on every render and consumers re-render unnecessarily.
- Keep context scope narrow — one responsibility per provider. Big "AppContext" grab-bags cause avoidable re-renders.

---

## Performance

- Do **not** start with `React.memo` / `useMemo` / `useCallback`. Measure first.
- Add memoization only when a profile shows the problem. Premature memo is a maintenance tax.
- Virtualize long lists with `@tanstack/react-virtual` or `react-window` — add as a dependency only when needed.
- Use `Suspense` boundaries at every async leaf with a `loading.tsx` or explicit fallback.

---

## Accessibility

- Every interactive element has a semantic role — `<button>`, `<a>` with `href`, form controls with labels. `<div onClick>` is banned; use `<button type="button">`.
- Icon-only buttons have `aria-label`.
- Focus management on modal open/close; use the `@radix-ui/react-dialog` primitive via shadcn/ui rather than hand-rolling. See [tailwind-guidelines.md](tailwind-guidelines.md) → "shadcn/ui".
- Test with keyboard only — Tab, Enter, Space, Escape must work on every flow.

---

## Error boundaries

Use Next.js `error.tsx` per segment (see [nextjs-guidelines.md](nextjs-guidelines.md)). For client subtrees that need recovery without a full route bounce, drop a small client error boundary built with `react-error-boundary`:

```tsx
'use client';
import { ErrorBoundary } from 'react-error-boundary';

export function SafeSection({ children }: { children: ReactNode }) {
  return <ErrorBoundary fallback={<p>Something went wrong.</p>}>{children}</ErrorBoundary>;
}
```

`react-error-boundary` is the only third-party abstraction we use for this; it's tiny and stable.

---

## Common pitfalls

1. **Derived state in `useState` + `useEffect`** — compute during render, not in an effect.
2. **Key warnings in lists** — use a stable unique ID. Never use the index as a key when items can reorder/delete.
3. **`onChange` handlers that call `setState` with the whole object** — batch state updates or use `useReducer` when updates interact.
4. **Fetching inside a client component when a server component could** — ship it up the tree, avoid the waterfall.
5. **Context value created inline** — every render produces a new object; every consumer re-renders. Memoize.
6. **`useEffect` depending on an inline callback** — wrap the callback in `useCallback` or lift it outside the effect.
7. **`React.FC` + children implicit** — switch to `type Props = { children: ReactNode }`.
8. **Missing `aria-*`, missing labels** — screen readers see a blank button.

---

## References

- React docs: https://react.dev
- React 19 release notes: https://react.dev/blog/2024/12/05/react-19
- `use()` API: https://react.dev/reference/react/use
- Actions & `useActionState`: https://react.dev/reference/react/useActionState
- Accessibility checklist: https://www.a11yproject.com/checklist/
