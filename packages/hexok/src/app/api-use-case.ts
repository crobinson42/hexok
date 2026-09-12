import { CodedError, type ErrorMap, type Result } from '../core/index.js';
import type { AnyEventCatalog, PortToken } from '../domain/index.js';
import type { EventChannelCtor } from './types.js';

/**
 * Request/response application use case. Declare static `key`, `input`, `output`, `errors`, `ports`.
 *
 * ```ts
 * class CloseIncident extends ApiUseCase {
 *   static readonly key = 'incident.close'
 *   static readonly input = z.object({ id: z.string() })
 *   static readonly output = Incident.schema
 *   static readonly errors = { NOT_FOUND: { message: 'Incident not found' } } as const
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
  /** Discriminator for `App.from` / `isApiUseCase`. Do not override. */
  static readonly trigger = 'api' as const;
  /** When true, omitted from contract, HTTP RPC, and `app.local`. Still in completeness. */
  static readonly internal?: boolean;
  /** Dotted RPC path (`incident.close`). Must be unique among API use cases. */
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
  /** RPC middleware for this use case, after app-level `App.use`. */
  static readonly middleware?: readonly unknown[];

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
