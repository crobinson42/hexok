import { ApiUseCase, type ExecuteCtx } from 'hexok/app';
import { z } from 'zod';
import {
  Organization,
  organizationSchema,
} from '../../../domain/entities/organization.js';
import { DomainEvents } from '../../../domain/events/index.js';
import { OrganizationCreated } from '../../../domain/events/organization.js';
import {
  ClientEvents,
  OrganizationCreated as OrganizationCreatedClient,
} from '../../events/client/index.js';
import { OrganizationRepository } from '../../ports/repos/organizations-repo.js';
import { CreateUser } from '../users/create-user.js';

export class RegisterOrganization extends ApiUseCase {
  static readonly key = 'organization.register';

  static input = z.object({
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
    user: CreateUser.input.omit({ organizationIds: true }),
  });

  static output = z.object({
    organization: organizationSchema,
    user: CreateUser.output,
  });

  static errors = {
    ORGANIZATION_EXISTS: { message: 'Organization already exists' },
    ...CreateUser.errors,
  };

  static ports = {
    organizations: OrganizationRepository,
  };

  static publishes = [DomainEvents, ClientEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
    run,
  }: ExecuteCtx<typeof RegisterOrganization>) {
    const existingOrganization = await ports.organizations.get(
      input.organization.id,
    );
    if (existingOrganization) throw errors.ORGANIZATION_EXISTS();

    const organization = Organization.create({
      id: input.organization.id,
      name: input.organization.name,
    });
    await ports.organizations.save(organization);

    publish(new OrganizationCreated(organization.toProps()));
    publish(
      new OrganizationCreatedClient(organization.toProps(), {
        kind: 'organization',
        organizationIds: [organization.props.id],
      }),
    );

    const user = await run(CreateUser, {
      ...input.user,
      organizationIds: [organization.props.id],
    });

    return {
      organization: organization.toProps(),
      user,
    };
  }
}
