import type { Infer } from 'kerf/core';
import { DomainEvent } from 'kerf/domain';
import { organizationSchema } from '../../../domain/entities/organization.js';
import type { ClientCtx } from '../../../domain/schemas/client-ctx.js';

export class OrganizationCreated extends DomainEvent {
  static readonly key = 'organization.created';
  static readonly schema = organizationSchema;
  constructor(
    public readonly payload: Infer<typeof OrganizationCreated.schema>,
    public readonly ctx: ClientCtx,
  ) {
    super();
  }
}
