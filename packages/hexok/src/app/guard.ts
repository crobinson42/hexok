import type { EventUseCaseCtor, ExternalUseCaseCtor } from './types.js';

/** Argument to `Guard.allow`. No ports, no input, no Request. */
export type GuardArgs<Ctx = unknown> = {
  /** Leaf constructor (`Charge`), not an app base class. */
  ctor: ExternalUseCaseCtor | EventUseCaseCtor;
  /** Request context for this guard. `defineGuard` types this as `InCtx`. */
  ctx: Ctx;
  /** Factories from `static errors`. Prefer `errors.UNAUTHORIZED()` / `errors.FORBIDDEN()`. */
  errors: Record<string, (data?: unknown) => never>;
};

/**
 * Identity / permission gate. Throw `CodedError` to refuse.
 * Return `void` to keep ctx; return a value to replace it for the rest of the call.
 * Object literals are unbranded: `OutCtx` is not inferable.
 */
export type Guard<InCtx = unknown, Ctx = unknown> = {
  readonly key: string;
  allow(args: GuardArgs<InCtx>): void | Ctx | Promise<void> | Promise<Ctx>;
};

declare const GuardOut: unique symbol;

/**
 * Returned only by `defineGuard`. The required unique-symbol brand makes
 * `OutCtx` inferable. Authors never write `[GuardOut]`.
 */
export type DefinedGuard<InCtx, OutCtx = InCtx> = Guard<InCtx> & {
  readonly [GuardOut]: OutCtx;
};

/** Brand a gate so `ExecuteCtx` / `EventCtx` can chain `InCtx` to `OutCtx`. */
export function defineGuard<InCtx, OutCtx = InCtx>(
  guard: Guard<InCtx>,
): DefinedGuard<InCtx, OutCtx> {
  return guard as DefinedGuard<InCtx, OutCtx>;
}
