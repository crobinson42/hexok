import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { Infer } from '../core/index.js';
import {
  type AnyEventCatalog,
  DomainEvent,
  EventCatalog,
  Port,
} from '../domain/index.js';
import { ApiUseCase } from './api-use-case.js';
import { deriveContract } from './contract.js';
import { errorFactories } from './error-factory.js';
import { EventUseCase } from './event-use-case.js';
import type { EventCtx, ExecuteCtx, Publish } from './execute-ctx.js';
import type { CheckUseCase } from './types.js';

interface IncidentRepository {
  get(id: string): Promise<{ id: string } | null>;
}
const IncidentRepository = Port.token<IncidentRepository>('IncidentRepository');

interface Clock {
  now(): Date;
}
const Clock = Port.token<Clock>('Clock');

class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed';
  static readonly schema = z.object({ id: z.string() });
  declare private readonly __brand: 'incident.closed';
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super();
  }
}

class ForeignEvent extends DomainEvent {
  static readonly key = 'foreign';
  static readonly schema = z.object({ id: z.string() });
  declare private readonly __brand: 'foreign';
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
    ALREADY_CLOSED: { message: 'Incident already closed' },
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
  static readonly key = 'incident.notifyOnClose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents;

  async execute(_ctx: EventCtx<typeof NotifyOnClose>): Promise<void> {}
}

class MissingPorts extends ApiUseCase {
  static readonly key = 'missing.ports';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  async execute(): Promise<unknown> {
    return {};
  }
}

class MissingInput extends ApiUseCase {
  static readonly key = 'missing.input';
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };
  async execute(): Promise<unknown> {
    return {};
  }
}

class WidePublishes extends ApiUseCase {
  static readonly key = 'wide.publishes';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };
  static readonly publishes = [DomainEvents];
  async execute(): Promise<unknown> {
    return {};
  }
}

const Jobs = new EventCatalog('jobs', { kind: 'queue' }).event(IncidentClosed);

class MissingGroup extends EventUseCase {
  static readonly key = 'missing.group';
  static readonly on = IncidentClosed;
  static readonly catalog = Jobs;
  async execute(): Promise<void> {}
}

class MissingOn extends EventUseCase {
  static readonly key = 'missing.on';
  static readonly catalog = DomainEvents;
  async execute(): Promise<void> {}
}

class MissingCatalog extends EventUseCase {
  static readonly key = 'missing.catalog';
  static readonly on = IncidentClosed;
  async execute(): Promise<void> {}
}

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

class EmptyPublishes extends ApiUseCase {
  static readonly key = 'empty.publishes';
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };
  static readonly publishes = [] as const;
  async execute() {
    return {};
  }
}

const OtherEvents = new EventCatalog('other', { kind: 'bus' }).event(
  ForeignEvent,
);

class Mismatch extends EventUseCase {
  static readonly key = 'mismatch';
  static readonly on = IncidentClosed;
  static readonly catalog = OtherEvents;
  async execute(): Promise<void> {}
}

const EmptyCat = new EventCatalog('empty', { kind: 'bus' });
class OnEmpty extends EventUseCase {
  static readonly key = 'on.empty';
  static readonly on = IncidentClosed;
  static readonly catalog = EmptyCat;
  async execute(): Promise<void> {}
}

class Loose extends EventUseCase {
  static readonly key = 'loose';
  static readonly on = IncidentClosed;
  static readonly catalog = DomainEvents as AnyEventCatalog;
  async execute(): Promise<void> {}
}

describe('use-case constructors', () => {
  it('are protected so callers go through App.from', () => {
    const _typeChecks = () => {
      // @ts-expect-error ApiUseCase constructor is protected
      new CloseIncident();
      // @ts-expect-error EventUseCase constructor is protected
      new NotifyOnClose();
    };
    void _typeChecks;
  });
});

describe('CheckUseCase', () => {
  it('names missing static ports, on, and catalog', () => {
    expectTypeOf<
      CheckUseCase<typeof MissingPorts>
    >().toEqualTypeOf<`hexok: ApiUseCase "missing.ports" is missing static ports`>();
    expectTypeOf<
      CheckUseCase<typeof MissingOn>
    >().toEqualTypeOf<`hexok: EventUseCase "missing.on" is missing static on`>();
    expectTypeOf<
      CheckUseCase<typeof MissingCatalog>
    >().toEqualTypeOf<`hexok: EventUseCase "missing.catalog" is missing static catalog`>();
    expectTypeOf<
      CheckUseCase<typeof MissingInput>
    >().toEqualTypeOf<`hexok: ApiUseCase "missing.input" is missing static input`>();
    expectTypeOf<
      CheckUseCase<typeof MissingGroup>
    >().toEqualTypeOf<`hexok: EventUseCase "missing.group" is missing static group`>();
    expectTypeOf<
      CheckUseCase<typeof WidePublishes>
    >().toEqualTypeOf<`hexok: ApiUseCase "wide.publishes" static publishes must be \`as const\``>();
    expectTypeOf<CheckUseCase<typeof CloseIncident>>().toEqualTypeOf<
      typeof CloseIncident
    >();
  });

  it('rejects static on that is not in the catalog Events', () => {
    expectTypeOf<
      CheckUseCase<typeof Mismatch>
    >().toEqualTypeOf<`hexok: EventUseCase "mismatch" static on is not in catalog`>();
    expectTypeOf<
      CheckUseCase<typeof OnEmpty>
    >().toEqualTypeOf<`hexok: EventUseCase "on.empty" static on is not in catalog`>();
    expectTypeOf<CheckUseCase<typeof Loose>>().toEqualTypeOf<typeof Loose>();
    expectTypeOf<CheckUseCase<typeof NotifyOnClose>>().toEqualTypeOf<
      typeof NotifyOnClose
    >();
  });
});

describe('EventCtx', () => {
  it('types event.payload from static on', () => {
    expectTypeOf<
      EventCtx<typeof NotifyOnClose>['event']['payload']
    >().toEqualTypeOf<{ id: string }>();
  });

  it('keeps catalog name as the literal when Events is populated', () => {
    expectTypeOf<
      EventCtx<typeof NotifyOnClose>['event']['catalog']
    >().toEqualTypeOf<'domain'>();
  });
});

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

  it('types publish as registered catalog events only', () => {
    type Pub = ExecuteCtx<typeof CloseIncident>['publish'];
    expectTypeOf<Parameters<Pub>[0]>().toEqualTypeOf<IncidentClosed>();

    const _publishTypes = (publish: Pub) => {
      publish(new IncidentClosed({ id: '1' }));
      // @ts-expect-error foreign event is not in DomainEvents
      publish(new ForeignEvent({ id: '1' }));
    };
    void _publishTypes;
  });

  it('types empty publishes as never and keeps absent publishes callable', () => {
    expectTypeOf<
      Parameters<ExecuteCtx<typeof EmptyPublishes>['publish']>[0]
    >().toEqualTypeOf<never>();
    expectTypeOf<
      ExecuteCtx<typeof StampTime>['publish']
    >().toMatchTypeOf<Publish>();
  });

  it('types run as the child input and output', () => {
    const _runTypes = async (run: ExecuteCtx<typeof CloseIncident>['run']) => {
      const stamped = await run(StampTime, {});
      expectTypeOf(stamped).toEqualTypeOf<{ now: Date }>();
      const closed = await run(CloseIncident, { id: '1' });
      expectTypeOf(closed).toEqualTypeOf<{ id: string; status: string }>();
      // @ts-expect-error child input id is a string
      await run(CloseIncident, { id: 1 });
      // @ts-expect-error event handlers are not runnable
      await run(NotifyOnClose, {});
    };
    void _runTypes;
  });
});

describe('errorFactories', () => {
  it('throws CodedError with code and message', () => {
    const errors = errorFactories(CloseIncident.errors);
    expect(() => errors.NOT_FOUND()).toThrowError(/Incident not found/);
    try {
      errors.NOT_FOUND();
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' });
    }
  });
});

class InternalStamp extends ApiUseCase {
  static readonly key = 'clock.internalStamp';
  static readonly internal = true;
  static readonly input = z.object({});
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };
  async execute() {
    return {};
  }
}

class InternalClose extends ApiUseCase {
  static readonly key = 'incident.close';
  static readonly internal = true;
  static readonly input = z.object({ id: z.string() });
  static readonly output = z.object({});
  static readonly errors = {} as const;
  static readonly ports = { clock: Clock };
  async execute() {
    return {};
  }
}

describe('deriveContract', () => {
  it('nests API use cases and skips event handlers', () => {
    const contract = deriveContract({
      close: CloseIncident,
      notify: NotifyOnClose,
    });
    expect(Object.keys(contract.routes)).toEqual(['incident.close']);
    expect(contract.routes['incident.close']?.key).toBe('incident.close');
    expect(contract.routes['incident.notifyOnClose']).toBeUndefined();
  });

  it('skips internal api use cases', () => {
    const contract = deriveContract({
      close: CloseIncident,
      stamp: InternalStamp,
    });
    expect(Object.keys(contract.routes)).toEqual(['incident.close']);
    expect(contract.routes['clock.internalStamp']).toBeUndefined();
  });

  it('throws on duplicate key', () => {
    expect(() =>
      deriveContract({ a: CloseIncident, b: CloseIncident }),
    ).toThrow('hexok: duplicate use-case key "incident.close"');
  });

  it('throws on duplicate key when an internal shares a key', () => {
    expect(() =>
      deriveContract({ a: CloseIncident, b: InternalClose }),
    ).toThrow('hexok: duplicate use-case key "incident.close"');
    expect(() =>
      deriveContract({ a: InternalClose, b: InternalClose }),
    ).toThrow('hexok: duplicate use-case key "incident.close"');
  });
});
