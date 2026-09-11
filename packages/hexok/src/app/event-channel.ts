import {
  CodedError,
  type ErrorMap,
  type Infer,
  type Result,
  type StandardSchemaV1,
} from '../core/index.js';
import type { Envelope, EventCatalog } from '../domain/index.js';
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
  static readonly trigger = 'channel' as const;
  static readonly errors: ErrorMap = {};

  protected constructor() {}

  abstract join(ctx: never): Promise<unknown>;
  abstract refresh(ctx: never): Promise<unknown>;
  abstract route(ctx: never): Promise<void>;

  error(code: string, data?: unknown): never {
    const def = (this.constructor as { errors?: ErrorMap }).errors?.[code];
    throw new CodedError({
      code,
      message: def?.message ?? code,
      ...(data !== undefined ? { data } : {}),
    });
  }

  unwrap<T, E extends string>(result: Result<T, E>): T {
    if (!result.ok) this.error(result.code);
    return result.value;
  }
}

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

export type JoinCtx<C> = {
  input: C extends { joinInput: infer S extends StandardSchemaV1 }
    ? Infer<S>
    : unknown;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
};

export type RefreshCtx<C> = {
  session: ChannelSession<C>;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  errors: C extends { errors: infer E }
    ? ErrorFactories<E>
    : ErrorFactories<never>;
};

export type RouteCtx<C> = {
  event: Envelope<
    string,
    unknown,
    CatalogKeyOfChannel<C>,
    'bus',
    CatalogCtxOfChannel<C>
  >;
  ctx: CatalogCtxOfChannel<C>;
  clients: ReadonlyArray<{ id: string; session: ChannelSession<C> }>;
  ports: C extends { ports: infer P }
    ? ResolvedPorts<P>
    : Record<string, never>;
  send: (id: string) => Promise<void>;
};

export type ChannelControl<Session = unknown> = {
  list(): ReadonlyArray<{ id: string; session: Session }>;
  eject(id: string): void;
  ejectWhere(pred: (session: Session) => boolean): void;
  refresh(id: string): Promise<void>;
  refreshWhere(pred: (session: Session) => boolean): Promise<void>;
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

export type ChannelProps<C> = C extends {
  channels: readonly (infer Ch)[];
}
  ? [Ch] extends [never]
    ? Record<string, never>
    : ChannelHandleMap<Ch>
  : Record<string, never>;
