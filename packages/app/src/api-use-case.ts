import { CodedError, type ErrorMap, type Result } from '@plinth/core';
import type { EventCatalog } from '@plinth/domain';
import type { Publish } from './execute-ctx.js';

/**
 * HTTP/RPC use case. Declare static `id`, `input`, `output`, `errors`, `ports`.
 *
 * ```ts
 * class CloseIncident extends ApiUseCase {
 *   static readonly id = 'incident.close'
 *   static readonly input = z.object({ id: z.string() })
 *   static readonly output = Incident.schema
 *   static readonly errors = { NOT_FOUND: { status: 404 } } as const
 *   static readonly ports = { incidents: IncidentRepository }
 *   async execute({ input, ports, errors }: ExecuteCtx<typeof CloseIncident>) {
 *     const incident = await ports.incidents.get(input.id)
 *     if (!incident) throw errors.NOT_FOUND()
 *     return incident.toProps()
 *   }
 * }
 * ```
 */
export abstract class ApiUseCase {
  static readonly trigger = 'api' as const;
  static readonly id: string;
  static readonly input: unknown;
  static readonly output: unknown;
  static readonly errors: ErrorMap = {};
  static readonly publishes?: readonly EventCatalog[];
  static readonly middleware?: readonly unknown[];

  abstract execute(ctx: {
    input: unknown;
    ports: Record<string, unknown>;
    ctx: unknown;
    errors: Record<string, (data?: unknown) => never>;
    signal: AbortSignal;
    publish: Publish;
  }): Promise<unknown>;

  /**
   * Typed factory: keys are the declared error map. Return type is `never`.
   */
  error(code: string, data?: unknown): never {
    const def = (this.constructor as { errors?: ErrorMap }).errors?.[code];
    throw new CodedError({
      code,
      status: def?.status ?? 400,
      message: def?.message ?? code,
      ...(data !== undefined ? { data } : {}),
    });
  }

  /**
   * Same one-liner as `if (!result.ok) throw this.error(result.code)`.
   */
  unwrap<T, E extends string>(result: Result<T, E>): T {
    if (!result.ok) this.error(result.code);
    return result.value;
  }
}
