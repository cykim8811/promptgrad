"use client";

/**
 * Tracks how many tenant-API fetches are in flight at any moment, and
 * exposes a hook that flips on after a configurable delay so any
 * component (here: the WarmingBar in layout.tsx) can react.
 *
 * Module-level state lets us track fetches kicked off anywhere —
 * identity.ts, api.ts, future helpers — without threading a context
 * through every component. The store is process-wide and React-aware
 * via `subscribers`.
 *
 * The wrapper `tracked()` increments on start and decrements on
 * settle, so it works for both success and failure.
 */

import { useEffect, useState } from "react";

let inFlight = 0;
const subscribers = new Set<() => void>();

function notify() {
  subscribers.forEach((fn) => fn());
}

export async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  inFlight += 1;
  notify();
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    if (inFlight < 0) inFlight = 0;
    notify();
  }
}

/**
 * Returns true when at least one tracked fetch has been in flight for
 * `delayMs` continuously. Flips back to false the moment everything
 * has settled.
 */
export function useWarming(delayMs = 5000): boolean {
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const evaluate = () => {
      if (inFlight > 0) {
        if (!timer) {
          timer = setTimeout(() => setWarming(true), delayMs);
        }
      } else {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        setWarming(false);
      }
    };

    subscribers.add(evaluate);
    evaluate();

    return () => {
      subscribers.delete(evaluate);
      if (timer) clearTimeout(timer);
    };
  }, [delayMs]);

  return warming;
}
