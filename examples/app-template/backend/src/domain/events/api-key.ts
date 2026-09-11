import type { Infer } from 'kerf/core';
import { DomainEvent } from 'kerf/domain';
import { apiKeySchema } from '../entities/api-key.js';

export class ApiKeyCreated extends DomainEvent {
  static readonly key = 'apiKey.created';
  static readonly schema = apiKeySchema;
  constructor(public readonly payload: Infer<typeof ApiKeyCreated.schema>) {
    super();
  }
}

export class ApiKeyUpdated extends DomainEvent {
  static readonly key = 'apiKey.updated';
  static readonly schema = apiKeySchema;
  constructor(public readonly payload: Infer<typeof ApiKeyUpdated.schema>) {
    super();
  }
}

export class ApiKeyDeleted extends DomainEvent {
  static readonly key = 'apiKey.deleted';
  static readonly schema = apiKeySchema.pick({ id: true });
  constructor(public readonly payload: Infer<typeof ApiKeyDeleted.schema>) {
    super();
  }
}
