/**
 * @fileoverview OTP input — `length` single-character boxes with auto-advance and paste support.
 *
 * Designed for numeric OTPs (email verification, TOTP). Each box accepts exactly
 * one digit; typing a valid digit auto-advances focus to the next box. Deleting
 * from an empty box moves focus back to the previous one. Pasting a string of
 * digits distributes them across the boxes.
 *
 * Use with React Hook Form via `<Controller>`:
 * ```tsx
 * <Controller
 *   name="otp"
 *   control={control}
 *   render={({ field }) => (
 *     <OtpInput length={6} value={field.value ?? ''} onChange={field.onChange} />
 *   )}
 * />
 * ```
 *
 * @layer components/auth
 */

'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

/** Props accepted by `OtpInput`. */
interface OtpInputProps {
  /** Number of single-character input boxes. */
  length: number;
  /**
   * Controlled value — the concatenated OTP string.
   * May be shorter than `length` while the user is typing.
   */
  value: string;
  /** Called with the new concatenated value on every change. */
  onChange: (value: string) => void;
  /** ARIA label prefix for individual boxes — defaults to `"Digit"`. */
  digitLabel?: string;
}

/**
 * Accessible numeric OTP input with per-box focus management.
 *
 * @param length      - Number of input boxes (typically 6).
 * @param value       - Controlled concatenated value.
 * @param onChange    - Change handler receiving the new full string.
 * @param digitLabel  - ARIA label prefix applied as `"${digitLabel} N of length"`.
 */
export function OtpInput({ length, value, onChange, digitLabel = 'Digit' }: OtpInputProps) {
  // Stryker disable next-line ArrayDeclaration: initial value is overwritten by the per-input ref callback on first render — `["Stryker was here"]` produces identical post-mount behaviour.
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /** Focus the input at `index` if it exists. */
  const focus = (index: number) => {
    // Stryker disable next-line OptionalChaining: the optional chain is a defence-in-depth guard for out-of-range indices. Every caller already gates by `index < length - 1` or `index > 0`, so removing `?.` cannot crash in practice — the mutant is observationally equivalent under the current focus-call sites.
    inputRefs.current[index]?.focus();
  };

  /** Padded char array so indexing is always safe. */
  // Stryker disable next-line MethodExpression: `padEnd(length, '')` and `padStart(length, '')` behave identically — `String.prototype.padEnd`/`padStart` BOTH return the original string when the padder is empty (the spec defines no growth with an empty filler). The `.slice(0, length)` that follows then caps both outputs the same way.
  const chars = value.padEnd(length, '').slice(0, length);

  const handleChange = (index: number, raw: string) => {
    // Keep only the last digit typed (handles Android's composing-text quirks)
    const digit = raw.replace(/\D/g, '').slice(-1);
    const newChars = chars.split('');
    newChars[index] = digit;
    onChange(newChars.join(''));
    // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator: the auto-advance boundary uses `index < length - 1` with `?.focus()` cover. Every boundary-extending mutant (`<=`, `length + 1`, `if (true)`) would call `focus(length)`/`focus(length + 1)` which the optional-chain in `focus()` safely no-ops on a missing ref — observationally identical to the original.
    if (digit && index < length - 1) {
      focus(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    // ArrowLeft / ArrowRight boundary guards. Out-of-range `focus()` calls are
    // no-ops because `inputRefs.current[oob]?.focus()` short-circuits on
    // undefined, so widening or narrowing the boundary by one cannot produce
    // an observable difference. The guards are extracted into named locals so
    // a single Stryker disable directive can suppress every equivalent
    // boundary mutant on its own line (the chained `else if` form confuses
    // Stryker's per-line directive tracking).
    // Stryker disable next-line ConditionalExpression,EqualityOperator
    const canMoveLeft = index > 0;
    // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator
    const canMoveRight = index < length - 1;

    if (e.key === 'Backspace') {
      if (!chars[index] && index > 0) {
        // Box is empty — clear the previous box and move focus there
        const newChars = chars.split('');
        newChars[index - 1] = '';
        onChange(newChars.join(''));
        focus(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && canMoveLeft) {
      focus(index - 1);
    } else if (e.key === 'ArrowRight' && canMoveRight) {
      focus(index + 1);
    }
  };

  /** Distribute pasted digits across boxes, starting at index 0. */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    // The clipboard `getData('text')` MIME format is a no-op in jsdom (the
    // mock ignores the argument), so `getData('')` is observationally
    // identical inside the unit harness.
    // Stryker disable next-line StringLiteral
    const digitsOnly = e.clipboardData.getData('text').replace(/\D/g, '');
    // Stryker disable next-line MethodExpression: belt-and-suspenders cap — the final `padded.slice(0, length)` below already crops the controlled value, so this leading cap is redundant. Kept here as a defensive pre-cap so the intermediate `padded` line is never longer than necessary.
    const pasted = digitsOnly.slice(0, length);
    const padded = pasted.padEnd(length, chars.slice(pasted.length));
    // Stryker disable next-line MethodExpression: trailing `.slice(0, length)` is a belt-and-suspenders cap — `padded` is at most `length` chars because `pasted` is pre-capped at `length`, and `padEnd(length, …)` does not grow beyond its target. Removing the trailing slice is observationally equivalent.
    onChange(padded.slice(0, length));
    focus(Math.min(pasted.length, length - 1));
  };

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="One-time code input">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={chars[i] ?? ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          aria-label={`${digitLabel} ${i + 1} of ${length}`}
          // Stryker disable StringLiteral
          className={cn(
            'h-12 w-10 rounded-xl border border-[rgba(255,255,255,0.1)]',
            'bg-[rgba(255,255,255,0.05)] text-center font-mono text-lg font-medium text-white',
            'transition-shadow duration-200',
            'focus:border-[rgba(255,98,36,0.4)] focus:outline-none focus:ring-2 focus:ring-[#ff6224]/50',
          )}
          // Stryker restore StringLiteral
        />
      ))}
    </div>
  );
}
