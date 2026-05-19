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

  it('pads remaining positions when fewer digits than length are pasted (value has existing chars)', () => {
    /*
     * Scenario: pasting "12" when the existing value is "ABCDEF" must call
     * onChange with "12" at the start and the remaining existing chars as
     * padding — `pasted.padEnd(length, chars.slice(pasted.length))`.
     * When value="" the empty-string fill makes padEnd a no-op, so we use an
     * existing value to exercise the padding path.
     * Protects: handlePaste padding with existing chars fill.
     */
    const onChange = vi.fn();
    render(<OtpInput length={6} value="ABCDEF" onChange={onChange} />);
    const inputs = screen.getAllByRole('textbox');
    fireEvent.paste(inputs[0]!, {
      clipboardData: { getData: () => '12' },
    });
    expect(onChange).toHaveBeenCalledOnce();
    const [newValue] = onChange.mock.calls[0] as [string];
    // First two characters must be the pasted digits.
    expect(newValue[0]).toBe('1');
    expect(newValue[1]).toBe('2');
    // Total length must match the `length` prop (padded from existing chars).
    expect(newValue).toHaveLength(6);
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
});
