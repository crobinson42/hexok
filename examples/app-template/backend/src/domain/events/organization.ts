import type { Infer } from 'kerf/core';
import { DomainEvent } from 'kerf/domain';
import { organizationSchema } from '../entities/organization.js';

export class OrganizationCreated extends DomainEvent {
  static readonly key = 'organization.created';
  static readonly schema = organizationSchema;
  constructor(
    public readonly payload: Infer<typeof OrganizationCreated.schema>,
  ) {
    super();
  }
}

export class OrganizationUpdated extends DomainEvent {
  static readonly key = 'organization.updated';
  static readonly schema = organizationSchema;
  constructor(
    public readonly payload: Infer<typeof OrganizationUpdated.schema>,
  ) {
    super();
  }
}

export class OrganizationDeleted extends DomainEvent {
  static readonly key = 'organization.deleted';
  static readonly schema = organizationSchema.pick({ id: true });
  constructor(
    public readonly payload: Infer<typeof OrganizationDeleted.schema>,
  ) {
    super();
  }
}
