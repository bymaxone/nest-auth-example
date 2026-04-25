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
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  /** Focus the input at `index` if it exists. */
  const focus = (index: number) => {
    inputRefs.current[index]?.focus();
  };

  /** Padded char array so indexing is always safe. */
  const chars = value.padEnd(length, '').slice(0, length);

  const handleChange = (index: number, raw: string) => {
    // Keep only the last digit typed (handles Android's composing-text quirks)
    const digit = raw.replace(/\D/g, '').slice(-1);
    const newChars = chars.split('');
    newChars[index] = digit;
    onChange(newChars.join(''));
    if (digit && index < length - 1) {
      focus(index + 1);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!chars[index] && index > 0) {
        // Box is empty — clear the previous box and move focus there
        const newChars = chars.split('');
        newChars[index - 1] = '';
        onChange(newChars.join(''));
        focus(index - 1);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focus(index - 1);
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focus(index + 1);
    }
  };

  /** Distribute pasted digits across boxes, starting at index 0. */
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    // Pad to `length` so the controlled value always has the right length
    onChange(pasted.padEnd(length, chars.slice(pasted.length)).slice(0, length));
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
          className={cn(
            'h-12 w-10 rounded-xl border border-[rgba(255,255,255,0.1)]',
            'bg-[rgba(255,255,255,0.05)] text-center font-mono text-lg font-medium text-white',
            'transition-shadow duration-200',
            'focus:border-[rgba(255,98,36,0.4)] focus:outline-none focus:ring-2 focus:ring-[#ff6224]/50',
          )}
        />
      ))}
    </div>
  );
}
