import type { Infer } from 'plinth/core';
import { DomainEvent } from 'plinth/domain';
import { userCredentialsSchema } from '../entities/user-credentials.js';

export class UserCredentialsCreated extends DomainEvent {
  static readonly key = 'userCredentials.created';
  static readonly schema = userCredentialsSchema;
  constructor(
    public readonly payload: Infer<typeof UserCredentialsCreated.schema>,
  ) {
    super();
  }
}

export class UserCredentialsUpdated extends DomainEvent {
  static readonly key = 'userCredentials.updated';
  static readonly schema = userCredentialsSchema;
  constructor(
    public readonly payload: Infer<typeof UserCredentialsUpdated.schema>,
  ) {
    super();
  }
}

export class UserCredentialsDeleted extends DomainEvent {
  static readonly key = 'userCredentials.deleted';
  static readonly schema = userCredentialsSchema.pick({ id: true });
  constructor(
    public readonly payload: Infer<typeof UserCredentialsDeleted.schema>,
  ) {
    super();
  }
}
