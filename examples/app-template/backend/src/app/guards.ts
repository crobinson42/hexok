import { ExternalUseCase, type Guard } from 'hexok/app';
import { CodedError } from 'hexok/core';
import type { Actor } from '../domain/schemas/actor.js';
import type { AppContext } from './context.js';
import { AuthErrors } from './errors.js';

export const authenticated: Guard = {
  key: 'authenticated',
  allow({ ctx, errors }) {
    if (!(ctx as AppContext).actor) {
      if (typeof errors.UNAUTHORIZED === 'function') errors.UNAUTHORIZED();
      throw new CodedError({
        code: 'UNAUTHORIZED',
        message: AuthErrors.UNAUTHORIZED.message,
      });
    }
  },
};

export abstract class PublicUseCase extends ExternalUseCase {
  static readonly guards = [] as const;
}

export abstract class UserUseCase extends ExternalUseCase {
  static readonly guards = [authenticated] as const;
  declare static context: AppContext & { actor: Actor };
}
