import { Entity, Event, Schema } from 'hexok';
import { z } from 'zod';
import { DomainError } from './errors.js';

export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

export class UserSchema extends Schema('User', userSchema) {}

export class UserEntity extends Entity('User', UserSchema) {
  rename(name: string): this {
    if (name.trim() === '') throw DomainError.BlankName();
    return this.set((draft) => {
      draft.name = name;
    });
  }
}

export class UserCreatedEvent extends Event('user.created', UserSchema) {}
