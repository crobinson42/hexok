import {
  ApiUseCase,
  type EventCtx,
  EventUseCase,
  type ExecuteCtx,
} from '@plinth/app';
import type { BrokerAdapter, BusAdapter } from '@plinth/domain';
import { DomainEvent, type Envelope, EventCatalog, Port } from '@plinth/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { App } from './app.js';
import type {
  DuplicateCatalogError,
  DuplicatePortError,
} from './completeness.js';

interface IncidentRepository {
  get(id: string): Promise<{ id: string; status: string } | null>;
  save(incident: { id: string; status: string }): Promise<void>;
}
const IncidentRepository = Port.token<IncidentRepository>('IncidentRepository');

interface Clock {
  now(): Date;
}
const Clock = Port.token<Clock>('Clock');

class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

const DomainEvents = new EventCatalog('domain', { kind: 'bus' }).event(
  IncidentClosed,
);

class CloseIncident extends ApiUseCase {
  static readonly key = 'incident.close';
  static readonly input = z.object({ id: z.string() });
  static readonly output = z.object({ id: z.string(), status: z.string() });
  static readonly errors = {
    NOT_FOUND: { status: 404, message: 'Incident not found' },
    FAIL: { status: 409, message: 'fail' },
  } as const;
  static readonly ports = {
    incidents: IncidentRepository,
    clock: Clock,
  };
  static readonly publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
  }: ExecuteCtx<typeof CloseIncident>) {
    const incident = await ports.incidents.get(input.id);
    if (!incident) throw errors.NOT_FOUND();
    if (input.id === 'boom') throw errors.FAIL();
    const closed = { id: incident.id, status: 'closed' };
    await ports.incidents.save(closed);
    publish(new IncidentClosed({ id: closed.id }));
    return closed;
  }
}

function memoryBus(): BusAdapter & { published: Envelope[] } {
  const subs = new Map<string, Array<(e: Envelope) => Promise<void>>>();
  const published: Envelope[] = [];
  return {
    kind: 'bus',
    published,
    async publish(envelope) {
      published.push(envelope);
      for (const handler of subs.get(envelope.key) ?? []) {
        await handler(envelope);
      }
    },
    subscribe(key, handler) {
      const list = subs.get(key) ?? [];
      list.push(handler);
      subs.set(key, list);
    },
  };
}

function repo(seed: { id: string; status: string }[]) {
  const store = new Map(seed.map((row) => [row.id, row]));
  return {
    async get(id: string) {
      return store.get(id) ?? null;
    },
    async save(incident: { id: string; status: string }) {
      store.set(incident.id, incident);
    },
  } satisfies IncidentRepository;
}

const clock: Clock = { now: () => new Date('2026-01-01T00:00:00Z') };

class StampTime extends ApiUseCase {
  static readonly key = 'clock.stamp';
  static readonly input = z.object({});
  static readonly output = z.object({ now: z.date() });
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };

  async execute({ ports }: ExecuteCtx<typeof StampTime>) {
    return { now: ports.clock.now() };
  }
}

describe('App completeness', () => {
  it('types build as a missing-port message when Clock is omitted', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unprovided port "clock" (used by incident.close). Call .provide(token, impl) before .build()`>();
  });

  it('joins use-case keys when one missing port is used by several use cases', () => {
    const builder = App.from({ close: CloseIncident, stamp: StampTime })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unprovided port "clock" (used by incident.close, clock.stamp). Call .provide(token, impl) before .build()`>();
  });

  it('names each missing port when several are omitted', () => {
    const builder = App.from({ close: CloseIncident }).bind(
      DomainEvents,
      memoryBus(),
    );
    expectTypeOf(builder.build).toEqualTypeOf<
      | `plinth: unprovided port "clock" (used by incident.close). Call .provide(token, impl) before .build()`
      | `plinth: unprovided port "incidents" (used by incident.close). Call .provide(token, impl) before .build()`
    >();
  });

  it('uses the token key when Port.token is given a literal Name', () => {
    const NamedClock = Port.token<Clock, 'Clock'>('Clock');
    class Tick extends ApiUseCase {
      static readonly key = 'clock.tick';
      static readonly input = z.object({});
      static readonly output = z.object({ now: z.date() });
      static readonly errors = {} as const;
      static readonly ports = { clock: NamedClock };
      async execute({ ports }: ExecuteCtx<typeof Tick>) {
        return { now: ports.clock.now() };
      }
    }
    const builder = App.from({ tick: Tick });
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unprovided port "Clock" (used by clock.tick). Call .provide(Clock, impl) before .build()`>();
  });

  it('uses the token key when Port.token is curried', () => {
    const CurriedClock = Port.token<Clock>()('Clock');
    class Tick extends ApiUseCase {
      static readonly key = 'clock.tick';
      static readonly input = z.object({});
      static readonly output = z.object({ now: z.date() });
      static readonly errors = {} as const;
      static readonly ports = { clock: CurriedClock };
      async execute({ ports }: ExecuteCtx<typeof Tick>) {
        return { now: ports.clock.now() };
      }
    }
    const builder = App.from({ tick: Tick });
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unprovided port "Clock" (used by clock.tick). Call .provide(Clock, impl) before .build()`>();
  });

  it('types build as a missing-catalog message when DomainEvents is unbound', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock);
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unbound catalog "domain" (used by incident.close). Call .bind(...) before .build()`>();
  });

  it('throws at runtime when a port is missing', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expect(() =>
      (builder as unknown as { build: () => unknown }).build(),
    ).toThrow('plinth: unprovided port "Clock" (used by incident.close)');
  });

  it('names duplicate provide/bind when the token/catalog name is a literal', () => {
    expectTypeOf<
      DuplicatePortError<'Clock'>
    >().toEqualTypeOf<`plinth: port "Clock" already provided`>();
    expectTypeOf<
      DuplicatePortError<string>
    >().toEqualTypeOf<`plinth: port already provided`>();
    expectTypeOf<
      DuplicateCatalogError<'domain'>
    >().toEqualTypeOf<`plinth: catalog "domain" already bound`>();
  });
});

describe('App invoke', () => {
  it('runs the use case, types local, and publishes after success', async () => {
    const bus = memoryBus();
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, bus)
      .build();

    expectTypeOf(app.local.incident.close).toBeFunction();
    const result = await app.local.incident.close({ id: '1' });
    expect(result).toEqual({ id: '1', status: 'closed' });
    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.key).toBe('incident.closed');
  });

  it('drops the publish queue when execute throws', async () => {
    const bus = memoryBus();
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: 'boom', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, bus)
      .build();

    await expect(
      app.local.incident.close({ id: 'boom' }),
    ).rejects.toMatchObject({
      code: 'FAIL',
    });
    expect(bus.published).toHaveLength(0);
  });

  it('handles HTTP POST /rpc/incident/close', async () => {
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus())
      .build();

    const response = await app.router.fetch(
      new Request('http://app/rpc/incident/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: '1' } }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      output: { id: string };
    };
    expect(body).toEqual({
      ok: true,
      output: { id: '1', status: 'closed' },
    });
  });

  it('drops events when aroundPublish swallows next()', async () => {
    const bus = memoryBus();
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, bus)
      .intercept({
        key: 'drop',
        aroundPublish: async () => {
          /* swallow */
        },
      })
      .build();
    await app.local.incident.close({ id: '1' });
    expect(bus.published).toHaveLength(0);
  });

  it('start() twice throws; stop() is idempotent', async () => {
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus())
      .build();
    await app.start();
    await expect(app.start()).rejects.toThrow('plinth: start() called twice');
    await app.stop();
    await app.stop();
    await app.start();
    await app.stop();
  });
});

class NotifyOnClose extends EventUseCase {
  static readonly key = 'incident.notifyOnClose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents;
  async execute(_ctx: EventCtx<typeof NotifyOnClose>): Promise<void> {}
}

describe('App type constraints', () => {
  it('types build as a function when ports and catalogs are provided', () => {
    const builder = App.from({ close: CloseIncident, notify: NotifyOnClose })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus());
    expectTypeOf(builder.build).toBeFunction();
  });

  it('rejects duplicate bind of the same catalog', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus());
    const _typeChecks = () => {
      // @ts-expect-error catalog already bound
      builder.bind(DomainEvents, memoryBus());
    };
    void _typeChecks;
  });

  it('rejects a wrong provide impl, duplicate provide, and kind mismatch', () => {
    const builder = App.from({ close: CloseIncident, notify: NotifyOnClose })
      .provide(IncidentRepository, repo([]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus());

    const _typeChecks = () => {
      // @ts-expect-error string is not a Clock
      builder.provide(Clock, 'nope');
      // @ts-expect-error Clock is already provided
      builder.provide(Clock, clock);
      const broker: BrokerAdapter = {
        kind: 'broker',
        publish: async () => {},
        consume: () => {},
      };
      // @ts-expect-error broker adapter is not a bus
      builder.bind(DomainEvents, broker);
    };
    void _typeChecks;

    const app = builder.build();
    expectTypeOf(app.local.incident.close).toBeFunction();
    expectTypeOf(app.local.incident).not.toHaveProperty('notifyOnClose');
  });
});
