import type { Infer } from 'hexok/core';
import { DomainEvent } from 'hexok/domain';
import { userSchema } from '../../../domain/entities/user.js';
import type {ClientEventCtx} from "../../context.js";

export class UserCreated extends DomainEvent {
  static readonly key = 'user.created';
  static readonly schema = userSchema;
  constructor(
    public readonly payload: Infer<typeof UserCreated.schema>,
    public readonly ctx: ClientEventCtx,
  ) {
    super();
  }
}
