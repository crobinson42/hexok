import { CodedError, type ErrorMap, type Result } from '../core/index.js';
import type { AnyEventCatalog, PortToken } from '../domain/index.js';
import type { EventChannelCtor } from './types.js';

/**
 * Request/response base for ExternalUseCase and InternalUseCase.
 * Do not declare `trigger` here — each sibling sets a distinct literal.
 * Not re-exported from hexok/app; application authors extend ExternalUseCase
 * or InternalUseCase.
 */
export abstract class CallableUseCase {
  /** Use-case id (`incident.close`). Unique among the callable family. */
  static readonly key: string;
  /** Request Standard Schema. Validated before `execute`. */
  static readonly input: unknown;
  /** Success Standard Schema. Types `execute`, `run`, and the contract. */
  static readonly output: unknown;
  /** Declared refusals. Keys become `errors.CODE()` factories on `ExecuteCtx`. */
  static readonly errors: ErrorMap = {};
  /** Port tokens keyed by the alias used in `execute`. Required by `App.from`. */
  static readonly ports?: Record<string, PortToken<unknown>>;
  /** `static publishes = [DomainEvents] as const` — without `as const`, Events widens to EventClass. */
  static readonly publishes?: readonly AnyEventCatalog[];
  /** `static channels = [ClientChannel] as const` — without `as const`, catalog keys widen. */
  static readonly channels?: readonly EventChannelCtor[];

  protected constructor() {}

  /** Typed `never` so subclasses may take `ExecuteCtx` (tighter `publish`). */
  abstract execute(ctx: never): Promise<unknown>;

  /**
   * Same one-liner as `if (!result.ok) throw new CodedError({ code: result.code })`.
   * For `validate` / custom Results. Entity methods throw themselves.
   */
  unwrap<T, E extends string>(result: Result<T, E>): T {
    if (!result.ok) {
      throw new CodedError({
        code: result.code,
        message: result.code,
        ...(result.issues !== undefined
          ? { data: { issues: result.issues } }
          : {}),
      });
    }
    return result.value;
  }
}
