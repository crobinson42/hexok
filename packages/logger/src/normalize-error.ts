export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * Maps an `Error` to a plain object. Non-errors, including strings, return
 * `undefined` so callers leave them as strings.
 */
export function normalizeError(value: unknown): NormalizedError | undefined {
  if (!(value instanceof Error)) return undefined;
  const normalized: NormalizedError = {
    name: value.name,
    message: value.message,
  };
  if (typeof value.stack === 'string') {
    normalized.stack = value.stack;
  }
  return normalized;
}
