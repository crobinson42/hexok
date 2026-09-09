import { CodedError, type ErrorMap, type Result } from '@plinth/core';
import type { EventCatalog } from '@plinth/domain';
import type { Publish } from './execute-ctx.js';

/**
 * Event handler. Mutually exclusive with `ApiUseCase`. Broker catalogs
 * require `static group`.
 *
 * ```ts
 * class NotifyOnClose extends EventUseCase {
 *   static readonly id = 'incident.notifyOnClose'
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
  static readonly id: string;
  static readonly group?: string;
  static readonly publishes?: readonly EventCatalog[];
  static readonly errors: ErrorMap = {};
  static readonly middleware?: readonly unknown[];

  abstract execute(ctx: {
    event: unknown;
    ports: Record<string, unknown>;
    ctx: unknown;
    errors: Record<string, (data?: unknown) => never>;
    signal: AbortSignal;
    publish: Publish;
    attempt?: number;
  }): Promise<void>;

  error(code: string, data?: unknown): never {
    const def = (this.constructor as { errors?: ErrorMap }).errors?.[code];
    throw new CodedError({
      code,
      status: def?.status ?? 400,
      message: def?.message ?? code,
      ...(data !== undefined ? { data } : {}),
    });
  }

  unwrap<T, E extends string>(result: Result<T, E>): T {
    if (!result.ok) this.error(result.code);
    return result.value;
  }
}
