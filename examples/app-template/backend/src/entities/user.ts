import { Entity } from 'hexok';
import { DomainError } from '../errors/domain.js';
import { UserSchema } from '../schemas/user.js';

export class UserEntity extends Entity('User', UserSchema) {
  rename(name: string): this {
    if (name.trim() === '') throw DomainError.BlankName();
    return this.set((draft) => {
      draft.name = name;
    });
  }
}
