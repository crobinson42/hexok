/**
 * Resolves `true` when `promise` settles within `ms`, and `false` when time runs out. It never rejects and clears its timer.
 * Use it to assert that a call such as `stop()` finishes in time without leaving a timer for the handle checks to find.
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
