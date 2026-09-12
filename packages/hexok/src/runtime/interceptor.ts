import type { UseCaseClass } from '../app/index.js';
import type { Envelope, PortToken } from '../domain/index.js';

/** Structural execute/event ctx so interceptors can wrap `next` without `as never`. */
export type HandlerCtx = {
  /** Port impls aliased as the use case declared them (`ports.incidents`). */
  ports: Record<string, unknown>;
  /** Request context from `.ctx()` or a per-call override. */
  ctx: unknown;
  /** Error factories from the use-case error map. */
  errors: Record<string, (data?: unknown) => never>;
  /** Abort signal for this invocation. */
  signal: AbortSignal;
  /** Enqueue an event. Flushed only if `execute` returns. */
  publish(event: unknown): void;
  /** Invoke another API use case without re-entering interceptors or RPC middleware. */
  run?(useCase: unknown, input: unknown): Promise<unknown>;
  /** Parsed API input. Absent on event handlers. */
  input?: unknown;
  /** Envelope for event handlers. Absent on API use cases. */
  event?: unknown;
  /** Queue delivery attempt. Set only for queue handlers. */
  attempt?: number;
};

/** Interceptor `next` function. Receives the structural execute or event ctx. */
export type Handler = (ctx: HandlerCtx) => Promise<unknown>;

/**
 * Extension seam. First registered is **outer**.
 * Register authorize before unit of work so a forbidden call never opens a transaction.
 *
 * ```ts
 * class AuthorizeInterceptor implements Interceptor {
 *   readonly key = 'authorize'
 *   aroundUseCase(uc, next) {
 *     return async (ctx) => {
 *       const policy = (uc as { policy?: string }).policy
 *       if (policy) check(ctx, policy)
 *       return next(ctx)
 *     }
 *   }
 * }
 * ```
 *
 * `aroundPublish`: interceptors that swallow `next()` **drop** the event.
 * Publish flushes after the use-case onion, so a successful unit-of-work
 * commit naturally yields after-commit publish.
 */
export interface Interceptor {
  /** Unique registration id. Duplicate keys throw. */
  readonly key: string;
  /** Wrap API and event `execute`. Nested `run` does not re-enter this hook. */
  aroundUseCase?(uc: UseCaseClass, next: Handler): Handler;
  /** Wrap a provided port impl once at `build`. First registered is outer, same as the other hooks. */
  aroundAdapter?(port: PortToken<unknown>, impl: unknown): unknown;
  /** Wrap catalog publish after execute returns. Swallowing `next()` drops the event. */
  aroundPublish?(envelope: Envelope, next: () => Promise<void>): Promise<void>;
  /** Wrap one event-handler invocation. API use cases never call this hook. */
  aroundDispatch?(
    envelope: Envelope,
    uc: UseCaseClass,
    next: () => Promise<void>,
  ): Promise<void>;
}

/** Throw if a port impl is missing `bindTo`/`fork`. `provide()` calls this when the token flags the capability. */
export function requireCapability(
  token: PortToken<unknown>,
  impl: unknown,
  method: 'bindTo' | 'fork',
  label: 'Transactional' | 'RequestScoped',
): void {
  if (typeof (impl as { [k: string]: unknown })[method] !== 'function') {
    throw new Error(
      `hexok: ${token.key} is ${label.toLowerCase()} but the adapter does not implement ${label}`,
    );
  }
}
