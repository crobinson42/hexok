import type { Infer } from 'hexok/core';
import { DomainEvent } from 'hexok/domain';
import { userSchema } from '../entities/user.js';

export class UserCreated extends DomainEvent {
  static readonly key = 'user.created';
  static readonly schema = userSchema;
  constructor(public readonly payload: Infer<typeof UserCreated.schema>) {
    super();
  }
}

export class UserUpdated extends DomainEvent {
  static readonly key = 'user.updated';
  static readonly schema = userSchema;
  constructor(public readonly payload: Infer<typeof UserUpdated.schema>) {
    super();
  }
}

export class UserDeleted extends DomainEvent {
  static readonly key = 'user.deleted';
  static readonly schema = userSchema.pick({ id: true });
  constructor(public readonly payload: Infer<typeof UserDeleted.schema>) {
    super();
  }
}
