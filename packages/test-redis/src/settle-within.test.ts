import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { settleWithin } from './settle-within.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it('resolves true when the promise settles in time and clears its timer', async () => {
  await expect(settleWithin(Promise.resolve('x'), 1000)).resolves.toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('resolves true for a rejection and does not reject', async () => {
  await expect(
    settleWithin(Promise.reject(new Error('no')), 1000),
  ).resolves.toBe(true);
});

it('resolves false when time runs out and clears its timer', async () => {
  const settled = settleWithin(new Promise(() => {}), 500);
  await vi.advanceTimersByTimeAsync(500);
  await expect(settled).resolves.toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
