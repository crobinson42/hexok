import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  ApiUseCase,
  type EventCtx,
  EventUseCase,
  type ExecuteCtx,
} from '../app/index.js';
import type { BrokerAdapter, BusAdapter } from '../domain/index.js';
import {
  DomainEvent,
  type Envelope,
  EventCatalog,
  Port,
} from '../domain/index.js';
import { App, AppBuilder } from './app.js';
import type {
  DuplicateCatalogError,
  DuplicatePortError,
} from './completeness.js';
import { rpcPath } from './rpc.js';

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
    NOT_FOUND: { message: 'Incident not found' },
    FAIL: { message: 'fail' },
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

describe('AppBuilder', () => {
  it('constructor is private; App.from is the factory', () => {
    const _typeChecks = () => {
      // @ts-expect-error AppBuilder constructor is private
      new AppBuilder({ close: CloseIncident });
    };
    void _typeChecks;
  });
});

describe('App completeness', () => {
  it('types build as a missing-port message when Clock is omitted', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`kerf: unprovided port "clock" (used by incident.close). Call .provide(token, impl) before .build()`>();
  });

  it('joins use-case keys when one missing port is used by several use cases', () => {
    const builder = App.from({ close: CloseIncident, stamp: StampTime })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`kerf: unprovided port "clock" (used by incident.close, clock.stamp). Call .provide(token, impl) before .build()`>();
  });

  it('names each missing port when several are omitted', () => {
    const builder = App.from({ close: CloseIncident }).bind(
      DomainEvents,
      memoryBus(),
    );
    expectTypeOf(builder.build).toEqualTypeOf<
      | `kerf: unprovided port "clock" (used by incident.close). Call .provide(token, impl) before .build()`
      | `kerf: unprovided port "incidents" (used by incident.close). Call .provide(token, impl) before .build()`
    >();
  });

  it('types build as a missing-catalog message when DomainEvents is unbound', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .provide(Clock, clock);
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`kerf: unbound catalog "domain" (used by incident.close). Call .bind(...) before .build()`>();
  });

  it('throws at runtime when a port is missing', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expect(() =>
      (builder as unknown as { build: () => unknown }).build(),
    ).toThrow('kerf: unprovided port "Clock" (used by incident.close)');
  });

  it('names duplicate provide/bind', () => {
    expectTypeOf<DuplicatePortError>().toEqualTypeOf<`kerf: port already provided`>();
    expectTypeOf<
      DuplicateCatalogError<'domain'>
    >().toEqualTypeOf<`kerf: catalog "domain" already bound`>();
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

  it('publishes the same key to each catalog that registered the class', async () => {
    class DomainNote extends DomainEvent {
      static readonly key = 'note.posted';
      static readonly schema = z.object({ text: z.string() });
      constructor(public readonly payload: { text: string }) {
        super();
      }
    }
    class ClientNote extends DomainEvent {
      static readonly key = 'note.posted';
      static readonly schema = z.object({ text: z.string() });
      constructor(public readonly payload: { text: string }) {
        super();
      }
    }
    const Notes = new EventCatalog('domain', { kind: 'bus' }).event(DomainNote);
    const ClientNotes = new EventCatalog('client', { kind: 'bus' }).event(
      ClientNote,
    );

    class PostNote extends ApiUseCase {
      static readonly key = 'note.post';
      static readonly input = z.object({ text: z.string() });
      static readonly output = z.object({});
      static readonly errors = {} as const;
      static readonly ports = {};
      static readonly publishes = [Notes, ClientNotes] as const;

      async execute({ input, publish }: ExecuteCtx<typeof PostNote>) {
        publish(new DomainNote({ text: input.text }));
        publish(new ClientNote({ text: input.text }));
        return {};
      }
    }

    const domainBus = memoryBus();
    const clientBus = memoryBus();
    const app = App.from({ post: PostNote })
      .bind(Notes, domainBus)
      .bind(ClientNotes, clientBus)
      .build();

    await app.local.note.post({ text: 'hi' });
    expect(domainBus.published).toEqual([
      expect.objectContaining({
        catalog: 'domain',
        key: 'note.posted',
        payload: { text: 'hi' },
      }),
    ]);
    expect(clientBus.published).toEqual([
      expect.objectContaining({
        catalog: 'client',
        key: 'note.posted',
        payload: { text: 'hi' },
      }),
    ]);
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

  it('maps NOT_FOUND to HTTP 404', async () => {
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus())
      .build();

    const response = await app.router.fetch(
      new Request('http://app/rpc/incident/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: 'missing' } }),
      }),
    );
    expect(response.status).toBe(404);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; status: number };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.status).toBe(404);
  });

  it('maps unknown error codes to HTTP 409', async () => {
    const app = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: 'boom', status: 'open' }]))
      .provide(Clock, clock)
      .bind(DomainEvents, memoryBus())
      .build();

    const response = await app.router.fetch(
      new Request('http://app/rpc/incident/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: { id: 'boom' } }),
      }),
    );
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string; status: number };
    };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('FAIL');
    expect(body.error.status).toBe(409);
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
    await expect(app.start()).rejects.toThrow('kerf: start() called twice');
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

describe('rpcPath', () => {
  it('turns dotted keys into /rpc paths', () => {
    expect(rpcPath('incident.close')).toBe('/rpc/incident/close');
  });
});
