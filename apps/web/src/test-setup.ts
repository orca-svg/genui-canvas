import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library drains its async wrapper with `jest.advanceTimersByTime(0)` whenever fake
// timers are on, and Vitest has no `jest` global. Without this bridge every `userEvent` call
// awaits a fake `setTimeout(0)` that never fires under `vi.useFakeTimers()`.
Object.assign(globalThis, { jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) } });

afterEach(() => {
  cleanup();
});
