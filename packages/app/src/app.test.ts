import type { Infer } from '@plinth/core';
import { DomainEvent, EventCatalog, Port } from '@plinth/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ApiUseCase } from './api-use-case.js';
import { deriveContract } from './contract.js';
import { errorFactories } from './error-factory.js';
import { EventUseCase } from './event-use-case.js';
import type { EventCtx, ExecuteCtx } from './execute-ctx.js';

interface IncidentRepository {
  get(id: string): Promise<{ id: string } | null>;
}
const IncidentRepository = Port.token<IncidentRepository>('IncidentRepository');

interface Clock {
  now(): Date;
}
const Clock = Port.token<Clock>('Clock');

class IncidentClosed extends DomainEvent {
  static readonly name = 'incident.closed';
  static readonly schema = z.object({ id: z.string() });
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
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
    ALREADY_CLOSED: { status: 409, message: 'Incident already closed' },
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
  }: ExecuteCtx<typeof CloseIncident>): Promise<{
    id: string;
    status: string;
  }> {
    const incident = await ports.incidents.get(input.id);
    if (!incident) throw errors.NOT_FOUND();
    void ports.clock.now();
    return { id: incident.id, status: 'closed' };
  }
}

class NotifyOnClose extends EventUseCase {
  static readonly id = 'incident.notifyOnClose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents;

  async execute(_ctx: EventCtx<typeof NotifyOnClose>): Promise<void> {}
}

describe('ExecuteCtx', () => {
  it('infers input, ports, and error factories from statics', () => {
    type Ctx = ExecuteCtx<typeof CloseIncident>;
    expectTypeOf<Ctx['input']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<Ctx['ports']['clock']>().toEqualTypeOf<Clock>();
    expectTypeOf<
      Ctx['ports']['incidents']
    >().toEqualTypeOf<IncidentRepository>();
    expectTypeOf<Ctx['errors']['NOT_FOUND']>().toEqualTypeOf<() => never>();

    type Nope = Ctx['errors'] extends { NOPE: infer _ } ? true : false;
    expectTypeOf<Nope>().toEqualTypeOf<false>();
  });
});

describe('errorFactories', () => {
  it('throws CodedError with status and message', () => {
    const errors = errorFactories(CloseIncident.errors);
    expect(() => errors.NOT_FOUND()).toThrowError(/Incident not found/);
    try {
      errors.NOT_FOUND();
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    }
  });
});

describe('deriveContract', () => {
  it('nests API use cases and skips event handlers', () => {
    const contract = deriveContract({
      close: CloseIncident,
      notify: NotifyOnClose,
    });
    expect(Object.keys(contract.routes)).toEqual(['incident.close']);
    expect(contract.routes['incident.close']?.path).toBe('/rpc/incident/close');
    expect(contract.routes['incident.notifyOnClose']).toBeUndefined();
  });

  it('throws on duplicate id', () => {
    expect(() =>
      deriveContract({ a: CloseIncident, b: CloseIncident }),
    ).toThrow('plinth: duplicate use-case id "incident.close"');
  });
});
