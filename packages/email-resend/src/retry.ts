export interface RetrySettings {
  readonly retries: number;
  readonly factor: number;
  readonly minTimeout: number;
  readonly maxTimeout: number;
  readonly randomize: boolean;
}

export function retryOptions(
  overrides?: Partial<RetrySettings>,
): RetrySettings {
  return {
    retries: overrides?.retries ?? 3,
    factor: overrides?.factor ?? 2,
    minTimeout: overrides?.minTimeout ?? 1000,
    maxTimeout: overrides?.maxTimeout ?? 5000,
    randomize: overrides?.randomize ?? true,
  };
}
