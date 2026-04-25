/**
 * @fileoverview Password input with show/hide visibility toggle.
 *
 * Wraps the base `<Input>` component and adds an `Eye`/`EyeOff` icon button
 * that toggles the `type` attribute between `"password"` and `"text"`.
 *
 * The toggle button is `type="button"` so it does not submit the surrounding
 * form. It is positioned absolutely within a relative container and has no
 * effect on the input's layout dimensions.
 *
 * Compatible with React Hook Form's `register()` via forwarded ref.
 *
 * @layer components/auth
 */

'use client';

import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** Props extend every native input attribute except `type`, which is managed internally. */
type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Password input field with a show/hide visibility toggle.
 *
 * The icon button is `aria-pressed` to signal the current visibility state
 * to assistive technologies.
 *
 * @example
 * ```tsx
 * <PasswordInput {...register('password')} placeholder="••••••••" />
 * ```
 */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
      <div className="relative">
        <Input
          {...props}
          ref={ref}
          type={isVisible ? 'text' : 'password'}
          className={cn('pr-12', className)}
        />
        <button
          type="button"
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          aria-pressed={isVisible}
          onClick={() => setIsVisible((v) => !v)}
          className={cn(
            'absolute right-4 top-1/2 -translate-y-1/2',
            'text-[rgba(255,255,255,0.4)] transition-colors duration-200 hover:text-[rgba(255,255,255,0.7)]',
            'rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff6224]/50',
          )}
        >
          {isVisible ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';
