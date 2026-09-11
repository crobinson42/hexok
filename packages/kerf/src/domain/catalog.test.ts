import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { Infer } from '../core/index.js';
import {
  type AnyEventCatalog,
  type CatalogEvents,
  EventCatalog,
} from './catalog.js';
import { DomainEvent, type EventWithCtx } from './event.js';

class IncidentClosed extends DomainEvent {
  static readonly key = 'incident.closed';
  static readonly schema = z.object({
    id: z.string(),
    closedAt: z.date(),
  });
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super();
  }
}

class IncidentOpened extends DomainEvent {
  static readonly key = 'incident.opened';
  static readonly schema = z.object({
    id: z.string(),
  });
  constructor(public readonly payload: Infer<typeof IncidentOpened.schema>) {
    super();
  }
}

describe('EventCatalog', () => {
  it('registers events, nests identifier paths, and get() returns the class', () => {
    const catalog = new EventCatalog('domain', { kind: 'bus' }).event(
      IncidentClosed,
    );
    expect(catalog.get(IncidentClosed)).toBe(IncidentClosed);
    const nested = catalog as unknown as {
      incident: { closed: typeof IncidentClosed };
    };
    expect(nested.incident.closed).toBe(IncidentClosed);
    expect(catalog.list()).toEqual([IncidentClosed]);
    expect(catalog.kind).toBe('bus');
  });

  it('rejects duplicate names', () => {
    const catalog = new EventCatalog('domain', { kind: 'bus' }).event(
      IncidentClosed,
    );
    expect(() => catalog.event(IncidentClosed)).toThrow(
      'kerf: duplicate event "incident.closed" in catalog "domain"',
    );
  });

  it('freezes and rejects further registration', () => {
    const catalog = new EventCatalog('domain', { kind: 'bus' })
      .event(IncidentClosed)
      .freeze();
    expect(catalog.frozen).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(() => catalog.event(IncidentClosed)).toThrow(
      'kerf: catalog "domain" is frozen',
    );
  });

  it('accumulates event classes on the Events generic', () => {
    const empty = new EventCatalog('domain', { kind: 'bus' });
    expectTypeOf<CatalogEvents<typeof empty>>().toEqualTypeOf<never>();

    const one = empty.event(IncidentClosed);
    expectTypeOf<CatalogEvents<typeof one>>().toEqualTypeOf<
      typeof IncidentClosed
    >();

    const two = one.event(IncidentOpened);
    expectTypeOf<CatalogEvents<typeof two>>().toEqualTypeOf<
      typeof IncidentClosed | typeof IncidentOpened
    >();

    const frozen = one.freeze();
    expectTypeOf<CatalogEvents<typeof frozen>>().toEqualTypeOf<
      typeof IncidentClosed
    >();

    expectTypeOf(two).toMatchTypeOf<AnyEventCatalog>();
    expectTypeOf<typeof two>().not.toMatchTypeOf<EventCatalog>();
  });

  it('ctx() requires instance.ctx on registered classes', () => {
    type Room = { room: string };
    class ChatSaid extends DomainEvent {
      static readonly key = 'chat.said';
      static readonly schema = z.object({ text: z.string() });
      constructor(
        public readonly payload: { text: string },
        public readonly ctx: Room,
      ) {
        super();
      }
    }

    const catalog = new EventCatalog('client', { kind: 'bus' }).ctx<Room>();
    expect(catalog.hasCtx).toBe(true);
    catalog.event(ChatSaid);
    expect(catalog.list()).toEqual([ChatSaid]);

    expectTypeOf<EventWithCtx<typeof ChatSaid, Room>>().toEqualTypeOf<
      typeof ChatSaid
    >();
    expectTypeOf<
      EventWithCtx<typeof IncidentClosed, Room>
    >().toEqualTypeOf<'kerf: event "incident.closed" is missing ctx for this catalog'>();
  });

  it('ctx() must be called once, before events', () => {
    const catalog = new EventCatalog('client', { kind: 'bus' }).ctx<{
      room: string;
    }>();
    expect(() => catalog.ctx<{ room: string }>()).toThrow(
      'kerf: catalog "client" already has ctx',
    );
    const domain = new EventCatalog('domain', { kind: 'bus' }).event(
      IncidentClosed,
    );
    expect(() => domain.ctx<{ room: string }>()).toThrow(
      'kerf: catalog "domain" ctx() must be called before .event()',
    );
    expect(domain.hasCtx).toBe(false);
  });
});
