import { Entity } from 'hexok';
import { DomainError } from '../errors/domain.js';
import { UserSchema } from '../schemas/user.js';

export class UserEntity extends Entity('User', UserSchema) {
  addMembership(organizationId: string): this {
    if (this.props.organizationIds.includes(organizationId)) {
      throw DomainError.AlreadyMember({
        userId: this.props.id,
        organizationId,
      });
    }
    return this.set((draft) => {
      draft.organizationIds = [...draft.organizationIds, organizationId];
    });
  }

  requireMember(organizationId: string): void {
    if (!this.props.organizationIds.includes(organizationId)) {
      throw DomainError.NotAMember({
        userId: this.props.id,
        organizationId,
      });
    }
  }
}
