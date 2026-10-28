/**
 * Resolves `true` when `promise` settles within `ms`, and `false` when time runs out. It never rejects and clears its timer.
 * It adds one reaction to `promise`. Do not call it in a loop on a promise that lives longer than the loop.
 */
export async function settleWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms), false);
  });
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. It never rejects, and it leaves no timer or listener behind. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal?.addEventListener('abort', done, { once: true });
  });
}
