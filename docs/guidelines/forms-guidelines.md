# Forms Guidelines

All `apps/web` forms use React Hook Form with Zod schemas. The library's auth forms follow this pattern, and every new form in the dashboard must too.

- **Packages**: `react-hook-form` `^7.72.x`, `zod` `^4.3.x`, `@hookform/resolvers` `^5.2.x`
- **UI primitives**: shadcn/ui form/input/label (see [tailwind-guidelines.md](tailwind-guidelines.md))
- **Toaster**: `sonner`
- **Official docs**: https://react-hook-form.com, https://zod.dev

---

## When to read this

Before creating or modifying any `<form>` in `apps/web/app/(auth)/*`, `apps/web/app/dashboard/*`, or a new feature. Use [validation-guidelines.md](validation-guidelines.md) for backend DTOs.

---

## The standard pattern

```tsx
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { mapAuthError } from '@/lib/auth-errors';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

type Values = z.infer<typeof schema>;

export function LoginForm() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await authClient.login(values);
      window.location.assign('/dashboard');
    } catch (err) {
      toast.error(mapAuthError(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={form.formState.errors.email ? true : undefined}
          {...form.register('email')}
        />
        {form.formState.errors.email ? (
          <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={form.formState.errors.password ? true : undefined}
          {...form.register('password')}
        />
        {form.formState.errors.password ? (
          <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
        ) : null}
      </div>

      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
```

---

## Rules

### Schema

1. **Declare the schema once, infer the type with `z.infer<typeof schema>`.** Never hand-type a parallel `type Values = { ... }`.
2. **Stabilize the schema reference** — declare outside the component, or wrap in `useMemo(() => schema, [])` when the schema depends on props (e.g., i18n'd messages). Recreating every render resets RHF's cached validation.
3. **No secrets in defaults**. `defaultValues` are serializable and may appear in DevTools. Never pre-fill an OTP or token.
4. **Medical-safety-critical fields stay blank.** Not relevant in this auth example, but the principle applies: do not autofill high-stakes numeric inputs.

### RHF configuration

- `mode: 'onTouched'` — errors appear after the user leaves the field, not on every keystroke. Friendlier on public pages.
- `reValidateMode: 'onChange'` — after the first error, correct-as-you-type feedback.
- `shouldUnregister: false` — keep values when the field unmounts (e.g., MFA challenge branching).

### Registration vs Controller

- **`register`** is the default for native `<input>`, `<textarea>`, `<select>`.
- **`Controller`** wraps controlled components (`<Select>` from shadcn/ui, date pickers, custom toggles). `register` does not work with components that don't expose a native `onChange` shape.

```tsx
<Controller
  control={form.control}
  name="role"
  render={({ field, fieldState }) => (
    <Select value={field.value} onValueChange={field.onChange}>
      {/* … */}
    </Select>
  )}
/>
```

### Submit handlers

- Always `form.handleSubmit(fn)` — it runs validation and prevents double submissions on its own.
- `async` submit handlers **must `await`** the server call; RHF tracks `isSubmitting` via the returned promise.
- Errors from the auth client map through `AUTH_ERROR_CODES` + `mapAuthError`. Never render a raw error message.
- On success, either call `toast.success(...)` (actions inside the dashboard) or navigate (auth entry points). Pick one per form; avoid both for the same event.

### Server-side errors

`apps/api` returns `{ code, message, field? }` on validation failure. Map field-scoped errors back into the form:

```ts
catch (err) {
  if (err.code === 'EMAIL_TAKEN') {
    form.setError('email', { type: 'server', message: 'This email is already registered.' });
    return;
  }
  toast.error(mapAuthError(err));
}
```

- **Never** call `form.reset()` on failure — you'll wipe the user's input. Keep values, surface the error next to the field.

### Accessibility

- Every `<input>` has a matching `<Label htmlFor>`. Placeholder text does **not** replace a label.
- `aria-invalid` reflects the field state. Screen readers will surface the error node when wired with `aria-describedby`.
- Error messages are next to the field, not in a toast alone. Toasts are secondary.
- Native `autoComplete` hints (`email`, `current-password`, `new-password`, `one-time-code`) unlock password managers and iOS autofill.

### Disabled / loading state

- `disabled` on the submit button mirrors `formState.isSubmitting`. Other fields stay enabled — letting the user fix a mistake mid-flight.
- Never disable submission to block double-click; RHF already guards.
- Swap the label to `Signing in…` / `Creating account…` when in-flight. Users need to know the click registered.

---

## Special forms

### OTP / MFA code input

Use a dedicated 6-digit input component (a shadcn recipe is available). Enforce `inputmode="numeric"`, `pattern="\\d{6}"`, `autocomplete="one-time-code"`. Schema:

```ts
const schema = z.object({ code: z.string().regex(/^\d{6}$/) });
```

### Password strength

Do not re-implement strength rules — the library enforces min length and common-password checks server-side. If a strength meter helps UX, drive it from a small utility, not a hooked schema validator.

### Multi-step forms

Use React Hook Form's `useForm` at the top, render steps as children, and maintain form state across steps by keeping `shouldUnregister: false`. For MFA setup → confirm → recovery codes, the form is logically one shape.

---

## Testing

- Unit-test with `@testing-library/react` + `user-event`. Type into inputs, assert the onSubmit receives the expected values.
- Mock `authClient` — never hit the network in unit tests.
- One Playwright flow per critical form (login, register, password reset, MFA setup). See [testing-guidelines.md](testing-guidelines.md).

---

## Common pitfalls

1. **Schema re-created every render** — RHF resets state, error messages blink.
2. **`register` with a custom component** — `onChange` shape mismatches silently; values never arrive. Use `Controller`.
3. **`mode: 'onChange'`** on create flows — every keystroke validates, form feels noisy.
4. **`form.reset()` on server error** — wipes user input.
5. **Rendering raw error messages from the server** — bypasses i18n, leaks internals. Map through `AUTH_ERROR_CODES`.
6. **Placeholder as a label** — screen readers ignore placeholder when a value is present.
7. **Submitting on Enter inside a nested form element** — only have one `<form>`; nested forms are invalid HTML.
8. **Autofocus on every field** — limit to the first input, and only when the form is the primary page content.

---

## References

- React Hook Form: https://react-hook-form.com
- Zod: https://zod.dev
- `@hookform/resolvers`: https://github.com/react-hook-form/resolvers
- shadcn form patterns: https://ui.shadcn.com/docs/components/form
- WCAG form guidance: https://www.w3.org/WAI/tutorials/forms/
