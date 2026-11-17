import { DomainError } from '../../domain/errors/domain.js';
import type { UserRepository } from '../ports/repos/user-repository.js';

/**
 * Shared membership policy. Loads the user and runs `User.requireMember`.
 * Post writes take this on `deps`. It is not a port.
 */
export class Membership {
  constructor(private readonly deps: { users: UserRepository }) {}

  async requireOrgMember(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const user = await this.deps.users.get(userId);
    if (user === null) throw DomainError.UserNotFound({ id: userId });
    user.requireMember(organizationId);
  }
}
