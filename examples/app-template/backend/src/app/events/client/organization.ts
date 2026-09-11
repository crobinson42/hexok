import type { Infer } from 'hexok/core';
import { DomainEvent } from 'hexok/domain';
import { organizationSchema } from '../../../domain/entities/organization.js';
import type { ClientEventCtx } from '../../context.js';

export class OrganizationCreated extends DomainEvent {
  static readonly key = 'organization.created';
  static readonly schema = organizationSchema;
  constructor(
    public readonly payload: Infer<typeof OrganizationCreated.schema>,
    public readonly ctx: ClientEventCtx,
  ) {
    super();
  }
}
