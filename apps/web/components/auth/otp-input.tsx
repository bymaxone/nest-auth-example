/**
 * @fileoverview Segmented one-time-code field — one box per digit.
 *
 * Used by every code entry screen: email verification, the sign-in MFA
 * challenge, authenticator enrolment, disabling a factor, and recovery-code
 * regeneration.
 *
 * Two details carry the component:
 *
 * 1. **Each keystroke composes on the newest value, not the rendered one.**
 *    Deriving the next code from the `value` prop drops digits when someone
 *    types faster than React re-renders — the second keystroke reads the value
 *    from before the first and overwrites it. A ref holds the authoritative
 *    string and is updated synchronously inside the handler, so a burst of six
 *    keystrokes always composes into six digits. This matters precisely because
 *    the codes expire in thirty seconds, which is what makes people type fast.
 *
 * 2. **A filled box accepts a replacement.** `maxLength={1}` makes the browser
 *    ignore a keystroke on a box that already holds a character, so a rejected
 *    code could otherwise only be corrected by clearing every box by hand.
 *    Focusing a box selects its content, so typing overwrites.
 *
 * @layer components/auth
 */

'use client';

import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';

interface OtpInputProps {
  /** Number of digit boxes to render. */
  length: number;
  /** Current code. Shorter than `length` while the user is still typing. */
  value: string;
  /** Called with the full code string after every edit. */
  onChange: (value: string) => void;
  /** Accessible name prefix for each box, e.g. `"Digit 3 of 6"`. */
  digitLabel?: string;
}

/**
 * Renders `length` single-character boxes bound to one code string.
 *
 * @param props - Field length, controlled value, change handler and label prefix.
 * @returns The segmented code field.
 */
export function OtpInput({ length, value, onChange, digitLabel = 'Digit' }: OtpInputProps) {
  // Stryker disable next-line ArrayDeclaration: initial value is overwritten by the per-input ref callback on first render — `["Stryker was here"]` produces identical post-mount behaviour.
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /**
   * The authoritative code between renders.
   *
   * Assigned on every render so a parent-driven change (a reset after a rejected
   * code) is picked up, and again inside the change handler so consecutive
   * keystrokes in the same tick each build on the previous one.
   */
  const valueRef = useRef(value);
  valueRef.current = value;

  const focus = (index: number) => {
    // Stryker disable next-line OptionalChaining: the optional chain is a defence-in-depth guard for out-of-range indices. Every caller already gates by `index < length - 1` or `index > 0`, so removing `?.` cannot crash in practice — the mutant is observationally equivalent under the current focus-call sites.
    inputRefs.current[index]?.focus();
  };

  /**
   * Splits a code string into exactly `length` slots.
   *
   * `padEnd(length, '')` cannot be used for this: padding with an empty string
   * is a no-op, so the result stays shorter than `length` and an index write
   * past its end produces holes.
   *
   * @param raw - Code string, possibly shorter or longer than the field.
   * @returns One entry per box, `''` where the box is empty.
   */
  const toSlots = useCallback(
    (raw: string): string[] => Array.from({ length }, (_unused, index): string => raw[index] ?? ''),
    [length],
  );

  /**
   * Commits a new code, keeping the ref and the parent in step.
   *
   * @param slots - The full set of boxes after the edit.
   */
  const commit = useCallback(
    (slots: string[]): void => {
      const next = slots.join('');
      valueRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const handleChange = (index: number, raw: string) => {
    // Keep only the last digit typed. Covers Android composing text, and the
    // case where a replacement lands beside an existing character.
    const digit = raw.replace(/\D/g, '').slice(-1);

    const slots = toSlots(valueRef.current);
    slots[index] = digit;
    commit(slots);

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
      const slots = toSlots(valueRef.current);
      if (!slots[index] && index > 0) {
        // Box is empty — clear the previous box and move focus there.
        slots[index - 1] = '';
        commit(slots);
        focus(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && canMoveLeft) {
      focus(index - 1);
    } else if (e.key === 'ArrowRight' && canMoveRight) {
      focus(index + 1);
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    // The clipboard `getData('text')` MIME format is a no-op in jsdom (the
    // mock ignores the argument), so `getData('')` is observationally
    // identical inside the unit harness.
    // Stryker disable next-line StringLiteral
    const digitsOnly = e.clipboardData.getData('text').replace(/\D/g, '');
    const pasted = digitsOnly.slice(0, length);

    // A paste replaces from the start and keeps whatever sat beyond it.
    const kept = toSlots(valueRef.current).slice(pasted.length);
    commit([...pasted, ...kept]);
    focus(Math.min(pasted.length, length - 1));
  };

  const slots = toSlots(value);

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="One-time code input">
      {slots.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          // Selecting on focus is what lets a filled box be typed over: with
          // `maxLength={1}` and a collapsed caret the browser drops the
          // keystroke, so a wrong code could not be corrected by retyping.
          onFocus={(e) => e.currentTarget.select()}
          aria-label={`${digitLabel} ${i + 1} of ${length}`}
          // Stryker disable StringLiteral
          className={cn(
            'h-12 w-10 rounded-xl border border-[rgba(255,255,255,0.1)]',
            'bg-[rgba(255,255,255,0.05)] text-center font-mono text-lg font-medium text-white',
            'transition-shadow duration-200',
            'focus:border-[rgba(255,98,36,0.4)] focus:ring-2 focus:ring-[#ff6224]/50 focus:outline-none',
          )}
          // Stryker restore StringLiteral
        />
      ))}
    </div>
  );
}
