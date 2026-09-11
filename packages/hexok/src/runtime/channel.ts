import { errorFactories } from '../app/error-factory.js';
import type {
  ChannelControl,
  ChannelSession,
  EventChannelCtor,
} from '../app/index.js';
import {
  CodedError,
  type Infer,
  type StandardSchemaV1,
  validate,
} from '../core/index.js';
import type {
  AnyEventCatalog,
  BusAdapter,
  ChannelAdapter,
  ChannelConnection,
  Envelope,
  EventAdapter,
  EventCatalog,
  PortToken,
} from '../domain/index.js';
import { aliasPorts } from './invoke.js';

export type ChannelGateway<C extends EventChannelCtor> = ChannelControl<
  ChannelSession<C>
> & {
  join(
    input: C extends { joinInput: infer S extends StandardSchemaV1 }
      ? Infer<S>
      : unknown,
    connection: ChannelConnection,
  ): Promise<ChannelSession<C>>;
};

type UnionToIntersection<U> = (
  U extends unknown
    ? (x: U) => void
    : never
) extends (x: infer I) => void
  ? I
  : never;

export type ChannelGateways<Routed> = [Routed] extends [never]
  ? Record<string, never>
  : UnionToIntersection<
      Routed extends infer C
        ? C extends EventChannelCtor
          ? C extends {
              catalog: EventCatalog<
                infer K extends string,
                infer _Kind,
                infer _E,
                infer _Ctx
              >;
            }
            ? { [P in K]: ChannelGateway<C> }
            : never
          : never
        : never
    >;

export type RoutedChannel = {
  ctor: EventChannelCtor;
  instance: {
    join(ctx: never): Promise<unknown>;
    refresh(ctx: never): Promise<unknown>;
    route(ctx: never): Promise<void>;
  };
  adapter: ChannelAdapter<unknown>;
  ports: Record<string, unknown>;
};

export function serializeChannelEnvelope(envelope: Envelope): string {
  return JSON.stringify({
    key: envelope.key,
    catalog: envelope.catalog,
    payload: envelope.payload,
    occurredAt: envelope.occurredAt,
  });
}

export function createChannelHandle(
  ctor: EventChannelCtor,
  instance: RoutedChannel['instance'],
  adapter: ChannelAdapter<unknown>,
  ports: Record<string, unknown>,
): ChannelGateway<EventChannelCtor> {
  const errors = errorFactories(ctor.errors ?? {});

  const refreshOne = async (id: string, session: unknown): Promise<void> => {
    const next = await instance.refresh({
      session,
      ports,
      errors,
    } as never);
    if (next === 'eject') {
      adapter.eject(id);
      return;
    }
    adapter.update(id, next);
  };

  return {
    list: () => adapter.list(),
    eject: (id) => {
      adapter.eject(id);
    },
    ejectWhere: (pred) => {
      for (const { id, session } of [...adapter.list()]) {
        if (pred(session)) adapter.eject(id);
      }
    },
    refresh: async (id) => {
      const row = adapter.list().find((item) => item.id === id);
      if (!row) return;
      await refreshOne(id, row.session);
    },
    refreshWhere: async (pred) => {
      for (const { id, session } of [...adapter.list()]) {
        if (pred(session)) await refreshOne(id, session);
      }
    },
    update: (id, session) => {
      adapter.update(id, session);
    },
    join: async (input, connection) => {
      const parsed = validate(ctor.joinInput, input);
      if (!parsed.ok) {
        throw new CodedError({
          code: 'VALIDATION',
          message: 'Validation failed',
        });
      }
      const session = await instance.join({
        input: parsed.value,
        ports,
        errors,
      } as never);
      const id = crypto.randomUUID();
      adapter.join(id, session, connection);
      connection.addEventListener('close', () => {
        adapter.leave(id);
      });
      return session;
    },
  };
}

export function startChannels(
  routed: Map<AnyEventCatalog, RoutedChannel>,
  bound: Map<AnyEventCatalog, EventAdapter>,
): void {
  for (const [catalog, { instance, adapter, ports }] of routed) {
    const eventAdapter = bound.get(catalog);
    if (eventAdapter?.kind !== 'bus') {
      throw new Error(
        `hexok: channel catalog "${catalog.key}" must be bound as a bus`,
      );
    }
    const bus = eventAdapter as BusAdapter;
    for (const eventClass of catalog.list()) {
      bus.subscribe(eventClass.key, async (envelope) => {
        const payload = serializeChannelEnvelope(envelope);
        await instance.route({
          event: envelope,
          ctx: envelope.ctx,
          clients: adapter.list(),
          ports,
          send: async (id: string) => {
            try {
              adapter.send(id, payload);
            } catch {
              adapter.leave(id);
            }
          },
        } as never);
      });
    }
  }
}

export async function stopChannelAdapters(
  routed: Map<AnyEventCatalog, RoutedChannel>,
): Promise<void> {
  for (const { adapter } of routed.values()) {
    await adapter.stop?.();
  }
}

export function resolveChannelPorts(
  ctor: EventChannelCtor,
  provided: Map<PortToken<unknown>, unknown>,
): Record<string, unknown> {
  return aliasPorts(ctor.ports ?? {}, provided);
}
