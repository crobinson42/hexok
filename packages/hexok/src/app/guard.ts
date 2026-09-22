import type { EventUseCaseCtor, ExternalUseCaseCtor } from './types.js';

/** Argument to `Guard.allow`. No ports, no input, no Request. */
export type GuardArgs = {
  /** Leaf constructor (`Charge`), not an app base class. */
  ctor: ExternalUseCaseCtor | EventUseCaseCtor;
  /** Read-only request context. */
  ctx: unknown;
  /** Factories from `static errors`. Prefer `errors.UNAUTHORIZED()` / `errors.FORBIDDEN()`. */
  errors: Record<string, (data?: unknown) => never>;
};

/** Identity / permission gate. Throw `CodedError` to refuse; return to allow. */
export type Guard = {
  readonly key: string;
  allow(args: GuardArgs): void | Promise<void>;
};
