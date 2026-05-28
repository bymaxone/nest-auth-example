/**
 * @fileoverview Unit tests for the `OtpInput` component.
 *
 * Verifies rendering, focus management, keyboard navigation, and paste
 * distribution. All tests run in the jsdom environment provided by the
 * Vitest global config. The component is controlled via a local `value`
 * wrapper inside each test to avoid prop-type gymnastics.
 *
 * @module components/auth/OtpInput.test
 */

// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OtpInput } from './otp-input.js';

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('OtpInput rendering', () => {
  it('renders the correct number of input boxes', () => {
    /*
     * Scenario: passing length=6 must produce exactly 6 individual input
     * elements so the user has one box per digit.
     * Protects: P13/P14 — OTP entry UI renders the right number of boxes.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(6);
  });

  it('renders the correct number of input boxes for a custom length', () => {
    /*
     * Scenario: length=4 (used for some reset codes) must produce exactly 4
     * input elements.
     * Protects: OtpInput respects the length prop for varying code sizes.
     */
    render(<OtpInput length={4} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(4);
  });

  it('assigns the default aria-label "Digit N of length" to each box', () => {
    /*
     * Scenario: the default digitLabel is "Digit"; each box must have an
     * accessible label like "Digit 1 of 6", "Digit 2 of 6", etc.
     * Protects: accessibility — screen-reader users can identify each box.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Digit 1 of 6' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Digit 3 of 6' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Digit 6 of 6' })).toBeDefined();
  });

  it('uses the digitLabel prop as aria-label prefix', () => {
    /*
     * Scenario: when digitLabel="Code" the aria-labels must read
     * "Code 1 of 6", "Code 2 of 6", etc.
     * Protects: digitLabel prop allows internationalised or custom labels.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} digitLabel="Code" />);
    expect(screen.getByRole('textbox', { name: 'Code 1 of 6' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Code 6 of 6' })).toBeDefined();
  });

  it('populates each box with the corresponding character from the value prop', () => {
    /*
     * Scenario: when value="123456" each input box must display the matching
     * digit in the correct position.
     * Protects: controlled-component rendering in OtpInput.
     */
    render(<OtpInput length={6} value="123456" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]).toHaveValue('1');
    expect(inputs[5]).toHaveValue('6');
  });
});

// ── onChange via typing ───────────────────────────────────────────────────────

describe('OtpInput onChange', () => {
  it('calls onChange with the digit placed at position 0 when the first box is changed', () => {
    /*
     * Scenario: typing "5" into the first input must call onChange with a
     * string that has "5" at index 0.
     * Protects: handleChange produces the correct concatenated value.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0]!, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    expect(newValue[0]).toBe('5');
  });

  it('calls onChange with the digit placed at position 2 when the third box is changed', () => {
    /*
     * Scenario: changing the third input with value="" starting from "12   "
     * must place the new digit at index 2.
     * Protects: handleChange respects the input index for mid-string edits.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="12    " onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[2]!, { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    expect(newValue[2]).toBe('9');
  });

  it('advances focus to the next box after a digit is typed', () => {
    /*
     * Scenario: entering a digit in box N must move focus to box N+1 so the
     * user can type the whole code without manually clicking each box.
     * Protects: auto-advance focus in handleChange.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    // Focus first input then fire a change event.
    inputs[0]!.focus();
    fireEvent.change(inputs[0]!, { target: { value: '3' } });
    // After auto-advance, the second input should be the active element.
    expect(document.activeElement).toBe(inputs[1]);
  });

  it('does not advance focus past the last box', () => {
    /*
     * Scenario: typing into the last box must NOT attempt to focus a box
     * beyond the array bounds (which would be undefined).
     * Protects: guard `index < length - 1` in handleChange.
     */
    render(<OtpInput length={6} value="12345" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[5]!.focus();
    expect(() => {
      fireEvent.change(inputs[5]!, { target: { value: '6' } });
    }).not.toThrow();
  });
});

// ── Backspace behaviour ───────────────────────────────────────────────────────

describe('OtpInput Backspace', () => {
  it('clears the current box value when Backspace is pressed on a non-empty box', () => {
    /*
     * Scenario: pressing Backspace while a box contains a digit should clear
     * that box; the onChange callback is NOT expected to fire here because
     * the `handleKeyDown` only handles the empty-box case for moving focus.
     * This test verifies that the box is not forcibly moved when it has a value.
     * Protects: handleKeyDown Backspace guard for non-empty boxes.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="123456" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    // Pressing Backspace on a non-empty box — handleKeyDown condition is false,
    // so focus should NOT move.
    inputs[3]!.focus();
    fireEvent.keyDown(inputs[3]!, { key: 'Backspace' });
    // Focus should stay on index 3 (no move to previous).
    expect(document.activeElement).toBe(inputs[3]);
    // onChange should not be called by keyDown alone.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves focus to the previous box and calls onChange when Backspace is pressed on an empty box', () => {
    /*
     * Scenario: pressing Backspace while a box is empty should clear the
     * previous box's character and move focus back to that box.
     * value="12" means chars[2] is undefined (falsy), so the empty-box branch
     * fires: onChange is called with index-1 cleared and focus moves to box 1.
     * Protects: handleKeyDown Backspace empty-box branch.
     */
    const onChange = vi.fn();
    // "12" — only indices 0 and 1 have digits; index 2 is beyond the string
    // so chars[2] is undefined (falsy), triggering the empty-box branch.
    render(<OtpInput length={6} value="12" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[2]!.focus();
    fireEvent.keyDown(inputs[2]!, { key: 'Backspace' });
    // onChange must be called (to clear the previous box).
    expect(onChange).toHaveBeenCalledOnce();
    // Focus must have moved to box 1.
    expect(document.activeElement).toBe(inputs[1]);
    // The new value must represent the cleared state: index 1 is gone
    // (joining ['1', ''] produces "1" whose index 1 is undefined/empty).
    const [newValue] = onChange.mock.calls[0] as [string];
    // The digit that was at position 1 must no longer appear as a digit.
    expect(newValue.startsWith('1')).toBe(true);
    expect(newValue).not.toContain('2');
  });
});

// ── Arrow key navigation ──────────────────────────────────────────────────────

describe('OtpInput arrow key navigation', () => {
  it('moves focus to the previous box on ArrowLeft', () => {
    /*
     * Scenario: pressing ArrowLeft from box index 2 must shift focus to
     * box index 1 without changing the value.
     * Protects: handleKeyDown ArrowLeft branch.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="123456" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[2]!.focus();
    fireEvent.keyDown(inputs[2]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(inputs[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves focus to the next box on ArrowRight', () => {
    /*
     * Scenario: pressing ArrowRight from box index 1 must shift focus to
     * box index 2 without changing the value.
     * Protects: handleKeyDown ArrowRight branch.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="123456" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[1]!.focus();
    fireEvent.keyDown(inputs[1]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(inputs[2]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not move focus left from the first box', () => {
    /*
     * Scenario: pressing ArrowLeft while already on box 0 should not throw
     * or move focus.
     * Protects: guard `index > 0` in handleKeyDown ArrowLeft branch.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[0]!.focus();
    expect(() => {
      fireEvent.keyDown(inputs[0]!, { key: 'ArrowLeft' });
    }).not.toThrow();
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('does not move focus right from the last box', () => {
    /*
     * Scenario: pressing ArrowRight while already on the last box should not
     * throw or move focus beyond the array.
     * Protects: guard `index < length - 1` in handleKeyDown ArrowRight branch.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[5]!.focus();
    expect(() => {
      fireEvent.keyDown(inputs[5]!, { key: 'ArrowRight' });
    }).not.toThrow();
    expect(document.activeElement).toBe(inputs[5]);
  });
});

// ── Paste handling ────────────────────────────────────────────────────────────

describe('OtpInput paste', () => {
  it('distributes all pasted digits across boxes when pasting "123456"', () => {
    /*
     * Scenario: pasting a full 6-digit string onto the first box must call
     * onChange with "123456" so every box is filled in one action.
     * Protects: handlePaste distributes pasted digits correctly.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '123456' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    expect(newValue).toBe('123456');
  });

  it('pads remaining positions with the SUFFIX of existing chars (chars.slice(pasted.length))', () => {
    /*
     * Scenario: pasting "12" when the existing value is "ABCDEF" must call
     * onChange with "12CDEF" — the pasted digits in front, then the
     * SUFFIX of the existing value starting at `pasted.length`. Pinning
     * the trailing characters is what distinguishes the correct
     * `chars.slice(pasted.length)` fill ("CDEF") from a regression to
     * `chars` ("ABCDEF" → would emit "12ABCD"). Without this assertion,
     * a wrong-fill mutant slips through because the test only checked
     * the leading characters and the total length.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="ABCDEF" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '12' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    // Pinned in full so trailing-character regressions are caught.
    expect(newValue).toBe('12CDEF');
  });

  it('strips non-digit characters from pasted text', () => {
    /*
     * Scenario: pasting "12 34-5" must strip spaces/dashes and produce
     * "12345" followed by padding — only digits pass through.
     * Protects: handlePaste `.replace(/\D/g, '')` sanitisation.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '12 34-5' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    expect(newValue.startsWith('12345')).toBe(true);
  });

  it('moves focus to the last filled box after paste', () => {
    /*
     * Scenario: after pasting "123456" focus must jump to box 5 (the last
     * box) so the user can immediately submit without tabbing.
     * Protects: handlePaste `focus(Math.min(pasted.length, length - 1))`.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[0]!.focus();
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '123456' },
    });
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('caps the paste at exactly `length` digits and ignores any overflow', () => {
    /*
     * Scenario: a careless paste delivers more digits than the input
     * accepts (e.g. 8 digits into a 6-box widget when the user copied a
     * longer code by mistake). Pins `handlePaste`'s `slice(0, length)`
     * cap — without it, the controlled value could exceed the visual
     * widget's length and the resulting OTP submission would carry the
     * extra digits, failing the API's length validation in a
     * difficult-to-diagnose way.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    fireEvent.paste(screen.getAllByRole('textbox')[0]!, {
      clipboardData: { getData: () => '12345678' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [emitted] = onChange.mock.calls[0] as [string];
    expect(emitted).toBe('123456');
    expect(emitted.length).toBe(6);
  });

  it('moves focus to the SHORTER paste length when fewer digits than length are pasted', () => {
    /*
     * Scenario: pasting "12" into the first box must leave focus on
     * box 2 (index 2 = `pasted.length`) — NOT on the last box — so the
     * user can immediately keep typing where the paste ended. Pins
     * the truthy branch of `Math.min(pasted.length, length - 1)` so a
     * regression to `Math.min(length - 1, pasted.length)` would still
     * pass but `length - 1` alone would land the cursor at the end.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[0]!.focus();
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '12' },
    });
    // After "12" → focus index 2 (third box).
    expect(document.activeElement).toBe(inputs[2]);
  });

  it('only registers the paste handler on the first box (not on the trailing boxes)', () => {
    /*
     * Scenario: a paste fired on box 4 (instead of box 0) must NOT call
     * `onChange` with the pasted full string because `onPaste` is only
     * bound to box 0. Pins the `i === 0 ? handlePaste : undefined`
     * branch of the input render. Without this, pasting in the middle
     * of the widget would clobber the leading digits.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[3]!, {
      clipboardData: { getData: () => '999999' },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ── Boundary guards + input sanitisation ──────────────────────────────────────

describe('OtpInput boundary guards and input sanitisation', () => {
  it('keeps only the LAST typed digit when the input event delivers a multi-character string', () => {
    /*
     * Scenario: Android composing-text and some IMEs deliver multi-char
     * change events (e.g. typing "5" while the previous digit "3" is
     * still composing arrives as "35"). The input must keep only the
     * trailing digit so the OTP boxes never carry stale composition
     * residue. Pins `digit = raw.replace(/\D/g, '').slice(-1)` — the
     * `slice(-1)` arm specifically.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    fireEvent.change(screen.getAllByRole('textbox')[0]!, {
      target: { value: '35' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [emitted] = onChange.mock.calls[0] as [string];
    expect(emitted[0]).toBe('5');
  });

  it('strips letters and punctuation from change events AND does not advance focus when no digit results', () => {
    /*
     * Scenario: pasting "a3" or typing a letter on a keyboard that does
     * not honour `inputMode="numeric"` (typical on iPad with a hardware
     * keyboard) must drop the non-digit characters silently AND keep
     * focus on the same box (no advance). Pins both the
     * `raw.replace(/\D/g, '')` sanitiser AND the `digit &&` short-
     * circuit guard — a regression of `&&` to `||` would advance focus
     * even when nothing typed, breaking the keyboard-flow contract.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[0]!.focus();
    fireEvent.change(inputs[0]!, { target: { value: 'a' } });
    // No digit landed → leading char is empty.
    const [emitted] = onChange.mock.calls[0] as [string];
    expect(emitted[0] ?? '').toBe('');
    // Focus must NOT have advanced — guards the `digit && index < length - 1`
    // short-circuit. A `||` regression would have focused box 1.
    expect(document.activeElement).toBe(inputs[0]);
  });

  it('does not move focus past the last box when the final digit is typed', () => {
    /*
     * Scenario: typing into the LAST box must not attempt to focus an
     * out-of-range box. Pins the `index < length - 1` guard in
     * `handleChange` so a regression to `index <= length - 1` would
     * crash on `inputRefs.current[length]?.focus()` (or focus the
     * non-existent next input).
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="12345" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[5]!.focus();
    fireEvent.change(inputs[5]!, { target: { value: '6' } });
    // Focus must stay on the last box.
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('does not move focus or call onChange when Backspace fires on box 0 with an empty value', () => {
    /*
     * Scenario: the very first box receives a Backspace while it is
     * empty — the `index > 0` guard must short-circuit so no negative
     * index is read. Pins the `index > 0` boundary of the Backspace
     * empty-box branch.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[0]!.focus();
    fireEvent.keyDown(inputs[0]!, { key: 'Backspace' });
    expect(document.activeElement).toBe(inputs[0]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('puts the empty string at the previous index when Backspace fires on an empty later box', () => {
    /*
     * Scenario: Backspace on an empty box must clear the PREVIOUS box
     * by writing an empty string at index - 1. Pins the
     * `newChars[index - 1] = ''` literal — a regression to
     * `'Stryker'` (or anything truthy) would leak into the OTP submission.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="ABC" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[3]!.focus();
    fireEvent.keyDown(inputs[3]!, { key: 'Backspace' });
    const [emitted] = onChange.mock.calls[0] as [string];
    // The character at index 2 must have been cleared.
    expect(emitted[2] ?? '').toBe('');
    // Surrounding characters untouched.
    expect(emitted[0]).toBe('A');
    expect(emitted[1]).toBe('B');
  });
});

// ── Per-box DOM contract ──────────────────────────────────────────────────────

describe('OtpInput per-box DOM attributes', () => {
  it('renders autoComplete="one-time-code" on the first box and "off" on every other box', () => {
    /*
     * Scenario: iOS auto-fill from the SMS app needs the FIRST box to
     * carry `autoComplete="one-time-code"`; the remaining boxes must
     * be explicitly opted out (`"off"`) so the OS does not race the
     * controlled-input flow. Pins both arms of the `i === 0` ternary
     * AND both literal strings.
     */
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs[0]!.getAttribute('autoComplete')).toBe('one-time-code');
    for (let i = 1; i < 6; i++) {
      expect(inputs[i]!.getAttribute('autoComplete')).toBe('off');
    }
  });

  it('uses an empty string as the box value when the controlled value runs out of characters', () => {
    /*
     * Scenario: with `value="12"` and `length=6`, boxes 3-6 must
     * display empty strings (not the literal "undefined" that
     * `chars[i]` would render without the `?? ''` coalesce). Pins
     * the empty-string fallback on the `<input value>` prop.
     */
    render(<OtpInput length={6} value="12" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole<HTMLInputElement>('textbox');
    expect(inputs[2]!.value).toBe('');
    expect(inputs[5]!.value).toBe('');
    // And the early boxes still carry the typed digits.
    expect(inputs[0]!.value).toBe('1');
    expect(inputs[1]!.value).toBe('2');
  });

  it('does not crash when the inputRefs slot is null and a focus is attempted', () => {
    /*
     * Scenario: the ref callback for an early input may run with `null`
     * when React unmounts the element before the focus side-effect
     * fires. The `?.focus()` optional chain in the `focus()` helper
     * prevents a TypeError. Pins that optional-chain by attempting a
     * keyboard action that triggers `focus()` after unmount.
     */
    const { unmount } = render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox');
    inputs[1]!.focus();
    unmount();
    // Re-render to get a fresh tree.
    render(<OtpInput length={6} value="" onChange={vi.fn()} />);
    // Triggering ArrowLeft on box 0 after a remount must not throw — the
    // focus helper guards against missing refs.
    const newInputs = screen.getAllByRole('textbox');
    newInputs[0]!.focus();
    expect(() => fireEvent.keyDown(newInputs[0]!, { key: 'ArrowLeft' })).not.toThrow();
  });
});
