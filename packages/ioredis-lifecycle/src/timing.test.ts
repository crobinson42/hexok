import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleWithin, sleep } from './timing.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('settleWithin', () => {
  it('resolves true when the promise settles in time and clears its timer', async () => {
    await expect(settleWithin(Promise.resolve('x'), 1000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves true for a rejection and does not reject', async () => {
    await expect(
      settleWithin(Promise.reject(new Error('no')), 1000),
    ).resolves.toBe(true);
  });

  it('resolves false when time runs out', async () => {
    const settled = settleWithin(new Promise(() => {}), 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(settled).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('sleep', () => {
  it('resolves after ms and leaves no timer', async () => {
    let done = false;
    const sleeping = sleep(1000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resolves early on abort and leaves no timer or listener', async () => {
    const abort = new AbortController();
    const sleeping = sleep(60_000, abort.signal);
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(1);
    abort.abort();
    await sleeping;
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
  });

  it('removes its listener when it ends on time', async () => {
    const abort = new AbortController();
    const sleeping = sleep(10, abort.signal);
    await vi.advanceTimersByTimeAsync(10);
    await sleeping;
    expect(getEventListeners(abort.signal, 'abort')).toHaveLength(0);
  });

  it('resolves at once for an aborted signal', async () => {
    await sleep(60_000, AbortSignal.abort());
    expect(vi.getTimerCount()).toBe(0);
  });
});
