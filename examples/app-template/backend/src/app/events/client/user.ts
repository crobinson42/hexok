import type { Infer } from 'plinth/core';
import { DomainEvent } from 'plinth/domain';
import { userSchema } from '../../../domain/entities/user.js';
import type { ClientCtx } from '../../../domain/schemas/client-ctx.js';

export class UserCreated extends DomainEvent {
  static readonly key = 'user.created';
  static readonly schema = userSchema;
  constructor(
    public readonly payload: Infer<typeof UserCreated.schema>,
    public readonly ctx: ClientCtx,
  ) {
    super();
  }
}
