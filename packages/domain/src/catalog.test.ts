import type { Infer } from '@plinth/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EventCatalog } from './catalog.js';
import { DomainEvent } from './event.js';

class IncidentClosed extends DomainEvent {
  static readonly name = 'incident.closed';
  static readonly schema = z.object({
    id: z.string(),
    closedAt: z.date(),
  });
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
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
      'plinth: duplicate event "incident.closed" in catalog "domain"',
    );
  });

  it('freezes and rejects further registration', () => {
    const catalog = new EventCatalog('domain', { kind: 'bus' })
      .event(IncidentClosed)
      .freeze();
    expect(catalog.frozen).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(() => catalog.event(IncidentClosed)).toThrow(
      'plinth: catalog "domain" is frozen',
    );
  });
});
