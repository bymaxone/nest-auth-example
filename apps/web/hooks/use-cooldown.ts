/**
 * @fileoverview useCooldown — client-side countdown timer with sessionStorage persistence.
 *
 * Persists the cooldown end timestamp to `sessionStorage` under the caller-supplied
 * `key`, so the remaining wait time survives component unmounts within the same
 * browser session. Multiple independent cooldowns use distinct keys and never
 * interfere with each other.
 *
 * SSR-safe: the initial state is always `0` (no cooldown) on the server; the
 * actual stored value is read after the first client-side mount.
 *
 * @module hooks/use-cooldown
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

/** Return value of `useCooldown`. */
interface UseCooldownReturn {
  /** `true` while the countdown is running (seconds remaining > 0). */
  isCoolingDown: boolean;
  /** Remaining seconds, rounded up. `0` when the cooldown has elapsed. */
  secondsLeft: number;
  /** Start the cooldown from `seconds` seconds. Safe to call while a cooldown is already active. */
  startCooldown: () => void;
}

/**
 * Client-side cooldown timer with sessionStorage persistence.
 *
 * @param key     - Unique sessionStorage key for this cooldown (e.g. `"verifyEmail:cooldown:user@example.com"`).
 * @param seconds - Cooldown duration in seconds.
 * @returns Controls and state for the countdown.
 */
export function useCooldown(key: string, seconds: number): UseCooldownReturn {
  /**
   * Read remaining seconds from sessionStorage.
   * Returns 0 on the server or when storage is unavailable.
   */
  const readRemaining = useCallback((): number => {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw === null) return 0;
      const end = parseInt(raw, 10);
      if (isNaN(end)) return 0;
      return Math.max(0, Math.ceil((end - Date.now()) / 1000));
    } catch {
      return 0;
    }
  }, [key]);

  const [secondsLeft, setSecondsLeft] = useState<number>(0);

  // Hydrate from storage after first client mount
  useEffect(() => {
    setSecondsLeft(readRemaining());
  }, [readRemaining]);

  // Tick the countdown every second while active
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setTimeout(() => {
      setSecondsLeft(readRemaining());
    }, 1000);
    return () => clearTimeout(id);
  }, [secondsLeft, readRemaining]);

  /**
   * Start the cooldown, writing the end timestamp to sessionStorage.
   *
   * @remarks Calling this while a cooldown is already running resets the timer.
   */
  const startCooldown = useCallback(() => {
    const end = Date.now() + seconds * 1000;
    try {
      sessionStorage.setItem(key, end.toString());
    } catch {
      // sessionStorage is unavailable in some restricted private-browsing modes;
      // the cooldown still works in-memory via state.
    }
    setSecondsLeft(seconds);
  }, [key, seconds]);

  return { isCoolingDown: secondsLeft > 0, secondsLeft, startCooldown };
}
