import { type EventCtx, EventUseCase } from 'hexok/app';
import { DomainEvents } from '../../../../domain/events/domain/catalog.js';
import { OrganizationCreated } from '../../../../domain/events/domain/organization.js';
import {
  ClientEvents,
  OrganizationCreated as OrganizationCreatedClient,
} from '../../../events/client/catalog.js';

export class OrganizationCreatedEventHandler extends EventUseCase {
  static readonly key = 'organization.onCreated';

  static readonly on = OrganizationCreated;

  static readonly catalog = DomainEvents;

  static readonly group = 'organization.onCreated';

  static readonly publishes = [ClientEvents] as const;

  async execute({
    event,
    publish,
  }: EventCtx<typeof OrganizationCreatedEventHandler>) {
    publish(
      new OrganizationCreatedClient(event.payload, {
        kind: 'organization',
        organizationIds: [event.payload.id],
      }),
    );
  }
}
