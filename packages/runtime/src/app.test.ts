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
  static readonly name = 'incident.closed';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: { id: string }) {
    super();
  }
}

const DomainEvents = new EventCatalog('domain', { kind: 'bus' }).event(
  IncidentClosed,
);

class CloseIncident extends ApiUseCase {
  static readonly id = 'incident.close';
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
      for (const handler of subs.get(envelope.name) ?? []) {
        await handler(envelope);
      }
    },
    subscribe(name, handler) {
      const list = subs.get(name) ?? [];
      list.push(handler);
      subs.set(name, list);
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

describe('App completeness', () => {
  it('types build as a missing-port message when Clock is omitted', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expectTypeOf(
      builder.build,
    ).toEqualTypeOf<`plinth: unprovided port (used by incident.close)`>();
  });

  it('throws at runtime when a port is missing', () => {
    const builder = App.from({ close: CloseIncident })
      .provide(IncidentRepository, repo([{ id: '1', status: 'open' }]))
      .bind(DomainEvents, memoryBus());
    expect(() =>
      (builder as unknown as { build: () => unknown }).build(),
    ).toThrow('plinth: unprovided port "Clock" (used by incident.close)');
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
    expect(bus.published[0]?.name).toBe('incident.closed');
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
        name: 'drop',
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
  static readonly id = 'incident.notifyOnClose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents;
  async execute(_ctx: EventCtx<typeof NotifyOnClose>): Promise<void> {}
}

describe('App type constraints', () => {
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
