import { CodedError, type ErrorMap, type Result } from '../core/index.js';
import type { AnyEventCatalog, EventClass } from '../domain/index.js';
import type { EventChannelCtor } from './types.js';

/**
 * Event handler. Mutually exclusive with `ApiUseCase`. Queue catalogs
 * require `static group`.
 *
 * ```ts
 * class NotifyOnClose extends EventUseCase {
 *   static readonly key = 'incident.notifyOnClose'
 *   static readonly on = IncidentClosed
 *   static readonly catalog = DomainEvents
 *   async execute({ event, ports }: EventCtx<typeof NotifyOnClose>) {
 *     await ports.notifier.send(event.payload)
 *   }
 * }
 * ```
 */
export abstract class EventUseCase {
  static readonly trigger = 'event' as const;
  static readonly key: string;
  static readonly on?: EventClass;
  static readonly catalog?: AnyEventCatalog;
  static readonly group?: string;
  static readonly publishes?: readonly AnyEventCatalog[];
  static readonly channels?: readonly EventChannelCtor[];
  static readonly errors: ErrorMap = {};
  static readonly middleware?: readonly unknown[];

  protected constructor() {}

  /** Typed `never` so subclasses may take `EventCtx` (tighter `publish`). */
  abstract execute(ctx: never): Promise<void>;

  error(code: string, data?: unknown): never {
    const def = (this.constructor as { errors?: ErrorMap }).errors?.[code];
    throw new CodedError({
      code,
      message: def?.message ?? code,
      ...(data !== undefined ? { data } : {}),
    });
  }

  /**
   * Same one-liner as `if (!result.ok) throw this.error(result.code)`.
   * For `validate` / custom Results. Entity methods throw themselves.
   */
  unwrap<T, E extends string>(result: Result<T, E>): T {
    if (!result.ok) this.error(result.code);
    return result.value;
  }
}
