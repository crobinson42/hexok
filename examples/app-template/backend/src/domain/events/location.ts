import type { Infer } from 'plinth/core';
import { DomainEvent } from 'plinth/domain';
import { locationSchema } from '../entities/location.js';

export class LocationCreated extends DomainEvent {
  static readonly key = 'location.created';
  static readonly schema = locationSchema;
  constructor(public readonly payload: Infer<typeof LocationCreated.schema>) {
    super();
  }
}

export class LocationUpdated extends DomainEvent {
  static readonly key = 'location.updated';
  static readonly schema = locationSchema;
  constructor(public readonly payload: Infer<typeof LocationUpdated.schema>) {
    super();
  }
}

export class LocationDeleted extends DomainEvent {
  static readonly key = 'location.deleted';
  static readonly schema = locationSchema.pick({ id: true });
  constructor(public readonly payload: Infer<typeof LocationDeleted.schema>) {
    super();
  }
}
