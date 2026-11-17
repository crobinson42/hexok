import type { UseCase } from 'hexok';
import { z } from 'zod';
import { ApiUseCase } from '../../../context.js';

export const logoutInput = z.object({});

/**
 * Requires a signed-in caller. The gateway deletes the session. This use
 * case does not see the token.
 */
export class Logout extends ApiUseCase('auth.logout', { input: logoutInput }) {
  async execute(
    _ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: z.infer<typeof logoutInput>,
  ): Promise<null> {
    return null;
  }
}
