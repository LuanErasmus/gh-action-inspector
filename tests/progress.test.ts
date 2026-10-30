import { stripVTControlCharacters } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgress } from "../src/progress.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("terminal progress", () => {
  it("animates, preserves elapsed time across updates, and clears without leaving a timer", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const status = createProgress(write, { color: true });
    status("Discovering workflows…");
    const first = write.mock.calls[0][0];
    expect(first).toContain("\x1b[35m");
    vi.advanceTimersByTime(160);
    expect(write.mock.calls.at(-1)![0]).not.toBe(first);
    status("Checking actions/checkout…  1/3");
    expect(stripVTControlCharacters(write.mock.calls.at(-1)![0])).toContain("1/3  0.2s");
    vi.advanceTimersByTime(15040);
    expect(write.mock.calls.at(-1)![0]).toContain("Still working");
    status(null);
    expect(write).toHaveBeenLastCalledWith("\r\x1b[K");
    const calls = write.mock.calls.length;
    vi.advanceTimersByTime(1000);
    status(null);
    expect(write).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fits narrow terminals without color and restarts elapsed time for a new operation", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const status = createProgress(write, { width: () => 20 });
    status("Checking a very long action reference");
    expect(stripVTControlCharacters(write.mock.calls.at(-1)![0]).trim().length).toBeLessThan(20);
    expect(write.mock.calls.at(-1)![0]).not.toContain("\x1b[35m");
    vi.advanceTimersByTime(1000);
    status(null);
    status("Done");
    expect(write.mock.calls.at(-1)![0]).toContain("0.0s");
    status(null);
  });
});
