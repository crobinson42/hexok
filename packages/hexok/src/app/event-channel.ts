import {
  CodedError,
  type ErrorMap,
  type Infer,
  type Result,
  type StandardSchemaV1,
} from '../core/index.js';
import type {
  AnyEventCatalog,
  Envelope,
  EventCatalog,
  PortToken,
} from '../domain/index.js';
import type { ErrorFactories, ResolvedPorts } from './types.js';

/**
 * Catalog-scoped delivery policy. Join, refresh, and route are app authority.
 * Presence I/O is a ChannelAdapter passed to `.route()`.
 *
 * ```ts
 * class ClientChannel extends EventChannel {
 *   static readonly catalog = ClientEvents
 *   static readonly joinInput = actorSchema
 *   async join({ input }: JoinCtx<typeof ClientChannel>) { return input }
 *   async refresh({ session }: RefreshCtx<typeof ClientChannel>) { return session }
 *   async route({ ctx, clients, send }: RouteCtx<typeof ClientChannel>) {
 *     for (const { id, session } of clients) {
 *       if (visibleTo(session, ctx)) await send(id)
 *     }
 *   }
 * }
 * ```
 */
export abstract class EventChannel {
  /** Discriminator for routed channels. Do not override. */
  static readonly trigger = 'channel' as const;
  /** Catalog whose events this channel delivers. Must be a bus. */
  static readonly catalog: AnyEventCatalog;
  /** Join-claims Standard Schema. Validated before `join`. */
  static readonly joinInput: unknown;
  /** Port tokens keyed by the alias used in join, refresh, and route. */
  static readonly ports?: Record<string, PortToken<unknown>>;
  /** Declared refusals. Keys become `errors.CODE()` factories on join/refresh. */
  static readonly errors: ErrorMap = {};

  protected constructor() {}

  /** Admit a client and return the session to store. Typed `never` so subclasses may take `JoinCtx`. */
  abstract join(ctx: never): Promise<unknown>;
  /** Recompute a session; return `'eject'` to drop the client. Typed `never` so subclasses may take `RefreshCtx`. */
  abstract refresh(ctx: never): Promise<unknown>;
  /** Choose recipients for a catalog event via `send(id)`. Typed `never` so subclasses may take `RouteCtx`. */
  abstract route(ctx: never): Promise<void>;

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

/** Session type returned from `join` and later passed to refresh and route. */
export type ChannelSession<C> = C extends {
  prototype: { join: (ctx: never) => Promise<infer S> };
}
  ? S
  : unknown;

type CatalogKeyOfChannel<C> = C extends {
  catalog: EventCatalog<
    infer K extends string,
    infer _Kind,
    infer _E,
    infer _Ctx
  >;
}
  ? K
  : string;

type CatalogCtxOfChannel<C> = C extends {
  catalog: EventCatalog<string, infer _Kind, infer _E, infer Ctx>;
}
  ? Ctx
  : unknown;

/** Argument to `EventChannel.join`. Typed from the channel class statics. */
export type JoinCtx<C> = {
  /** Validated `static joinInput`. */
  input: C extends { joinInput: infer S extends StandardSchemaV1 }
    ? Infer<S>
    : unknown;
  /** Bound adapters from `static ports`. */
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  /** Factories from `static errors`. Throw `errors.FORBIDDEN()`. */
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
};

/** Argument to `EventChannel.refresh`. Typed from the channel class statics. */
export type RefreshCtx<C> = {
  /** Current session from join or the last successful refresh. */
  session: ChannelSession<C>;
  /** Bound adapters from `static ports`. */
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  /** Factories from `static errors`. Throw `errors.FORBIDDEN()`. */
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
};

/** Argument to `EventChannel.route`. `ctx` here is catalog context, not app request context. */
export type RouteCtx<C> = {
  /** Envelope just published on this channel's catalog. */
  event: Envelope<
    string,
    unknown,
    CatalogKeyOfChannel<C>,
    'bus',
    CatalogCtxOfChannel<C>
  >;
  /** Catalog `ctx` from the envelope — not `ExecuteCtx.ctx`. */
  ctx: CatalogCtxOfChannel<C>;
  /** Connected clients and their sessions. */
  clients: ReadonlyArray<{ id: string; session: ChannelSession<C> }>;
  /** Bound adapters from `static ports`. */
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  /** Deliver the serialized event to one client id. */
  send: (id: string) => Promise<void>;
};

/** Presence handle for one catalog, from `channels` in `execute`. */
export type ChannelControl<Session = unknown> = {
  /** Connected clients and their sessions. */
  list(): ReadonlyArray<{ id: string; session: Session }>;
  /** Drop one client by id. */
  eject(id: string): void;
  /** Drop every client whose session matches. */
  ejectWhere(pred: (session: Session) => boolean): void;
  /** Re-run `refresh` for one client. */
  refresh(id: string): Promise<void>;
  /** Re-run `refresh` for matching sessions. */
  refreshWhere(pred: (session: Session) => boolean): Promise<void>;
  /** Replace a session without running `refresh`. */
  update(id: string, session: Session): void;
};

type UnionToIntersection<U> = (
  U extends unknown
    ? (x: U) => void
    : never
) extends (x: infer I) => void
  ? I
  : never;

type ChannelHandleMap<Ch> = [Ch] extends [never]
  ? Record<string, never>
  : UnionToIntersection<
      Ch extends infer C
        ? C extends {
            catalog: EventCatalog<
              infer K extends string,
              infer _Kind,
              infer _E,
              infer _Ctx
            >;
          }
          ? { [P in K]: ChannelControl<ChannelSession<C>> }
          : never
        : never
    >;

/** `channels` on execute ctx, keyed by catalog key from `static channels`. */
export type ChannelProps<C> = C extends {
  channels: readonly (infer Ch)[];
}
  ? [Ch] extends [never]
    ? Record<string, never>
    : ChannelHandleMap<Ch>
  : Record<string, never>;
