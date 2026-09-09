import type { Infer } from '@plinth/core';
import { DomainEvent, EventCatalog } from '@plinth/domain';
import { z } from 'zod';

export class IncidentClosed extends DomainEvent {
  static readonly name = 'incident.closed';
  static readonly schema = z.object({
    id: z.string(),
    closedAt: z.date(),
  });
  constructor(public readonly payload: Infer<typeof IncidentClosed.schema>) {
    super();
  }
}

export class IncidentOpened extends DomainEvent {
  static readonly name = 'incident.opened';
  static readonly schema = z.object({
    id: z.string(),
    title: z.string(),
    openedAt: z.date(),
  });
  constructor(public readonly payload: Infer<typeof IncidentOpened.schema>) {
    super();
  }
}

export const DomainEvents = new EventCatalog('domain', { kind: 'bus' }).event(
  IncidentClosed,
).event(IncidentOpened);
