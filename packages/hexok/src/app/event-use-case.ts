import { CodedError, type ErrorMap, type Result } from '../core/index.js';
import type {
  AnyEventCatalog,
  EventClass,
  PortToken,
} from '../domain/index.js';
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
  /** Discriminator for `App.from` / `isEventUseCase`. Do not override. */
  static readonly trigger = 'event' as const;
  /** Handler id (`incident.notifyOnClose`). Used in completeness messages. */
  static readonly key: string;
  /** Event class this handler listens to. Required by `App.from`; must be in `catalog`. */
  static readonly on?: EventClass;
  /** Catalog that owns `on`. Required by `App.from`; bind it with `App.bind`. */
  static readonly catalog?: AnyEventCatalog;
  /** Port tokens keyed by the alias used in `execute`. */
  static readonly ports?: Record<string, PortToken<unknown>>;
  /** Consumer group for queue catalogs. Required when `catalog.kind` is `'queue'`. */
  static readonly group?: string;
  /** `static publishes = [DomainEvents] as const` — without `as const`, Events widens to EventClass. */
  static readonly publishes?: readonly AnyEventCatalog[];
  /** `static channels = [ClientChannel] as const` — without `as const`, catalog keys widen. */
  static readonly channels?: readonly EventChannelCtor[];
  /** Declared refusals. Keys become `errors.CODE()` factories on `EventCtx`. */
  static readonly errors: ErrorMap = {};
  /** Same constructor field as API use cases; event dispatch does not run it. */
  static readonly middleware?: readonly unknown[];

  protected constructor() {}

  /** Typed `never` so subclasses may take `EventCtx` (tighter `publish`). */
  abstract execute(ctx: never): Promise<void>;

  /**
   * Throw a `CodedError` for a code in `static errors`.
   * Prefer `errors.CODE()` in `execute` for typed factories.
   */
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
