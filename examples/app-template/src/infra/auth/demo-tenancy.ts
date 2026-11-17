import type { OrganizationRepository } from '../../app/ports/repos/organization-repository.js';
import type { UserRepository } from '../../app/ports/repos/user-repository.js';
import { OrganizationEntity } from '../../domain/entities/organization.js';
import { UserEntity } from '../../domain/entities/user.js';

type OrganizationProps = ConstructorParameters<typeof OrganizationEntity>[0];
type UserProps = ConstructorParameters<typeof UserEntity>[0];

export const demoOrganization: OrganizationProps = {
  id: 'hexok',
  name: 'Hexok Blog',
};

export const demoTenancyUsers: readonly UserProps[] = [
  { id: 'ada', name: 'Ada', organizationIds: [demoOrganization.id] },
  { id: 'bea', name: 'Bea', organizationIds: [demoOrganization.id] },
];

/**
 * Writes ada, bea, and the demo organization when they are missing. HTTP
 * calls this at start. A test can pass the same props to an in-memory
 * store without awaiting this.
 */
export async function seedDemoTenancy(deps: {
  users: UserRepository;
  organizations: OrganizationRepository;
}): Promise<void> {
  if ((await deps.organizations.get(demoOrganization.id)) === null) {
    await deps.organizations.save(OrganizationEntity.create(demoOrganization));
  }
  for (const props of demoTenancyUsers) {
    if ((await deps.users.get(props.id)) === null) {
      await deps.users.save(UserEntity.create(props));
    }
  }
}
