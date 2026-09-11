import type { Infer } from 'hexok/core';
import { DomainEvent } from 'hexok/domain';
import { z } from 'zod';
import { apiKeySchema } from '../../../domain/entities/api-key.js';
import type { ClientEventCtx } from '../../context.js';

export class ApiKeyCreated extends DomainEvent {
  static readonly key = 'apiKey.created';
  static readonly schema = apiKeySchema.omit({ key: true });
  constructor(
    public readonly payload: Infer<typeof ApiKeyCreated.schema>,
    public readonly ctx: ClientEventCtx,
  ) {
    super();
  }
}

export class ApiKeyDeleted extends DomainEvent {
  static readonly key = 'apiKey.deleted';
  static readonly schema = z.object({
    id: z.string(),
  });
  constructor(
    public readonly payload: Infer<typeof ApiKeyDeleted.schema>,
    public readonly ctx: ClientEventCtx,
  ) {
    super();
  }
}
