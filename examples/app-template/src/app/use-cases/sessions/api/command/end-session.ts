import type { UseCase } from 'hexok';
import { z } from 'zod';
import { DomainError } from '../../../../../domain/errors/domain.js';
import type { Authenticator } from '../../../../ports/auth/authenticator.js';
import { ApiUseCase } from '../../../context.js';

export const endSessionInput = z.object({});

export type EndSessionInput = z.infer<typeof endSessionInput>;

/** Sign the caller out. The token stops checking out, in every process. */
export class EndSession extends ApiUseCase('session.end', {
  input: endSessionInput,
}) {
  constructor(
    private readonly deps: {
      authenticator: Authenticator;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: EndSessionInput,
  ): Promise<void> {
    if (ctx.caller === undefined) throw DomainError.SignInRequired();
    await this.deps.authenticator.revoke(ctx.caller);
  }
}
