import { ApiUseCase, type ExecuteCtx } from 'hexok/app';
import { z } from 'zod';
import { actorSchema } from '../../../domain/schemas/actor.js';
import { ApiKeyRepository } from '../../ports/repos/api-keys-repo.js';
import { AuthTokenService } from '../../ports/services/authTokenService.js';

export class AuthenticateApiKey extends ApiUseCase {
  static readonly key = 'auth.authenticateApiKey';

  static input = z.object({
    key: z.string(),
  });

  static output = z.object({
    actor: actorSchema,
    token: z.string(),
  });

  static errors = {
    INVALID_CREDENTIALS: { message: 'Invalid credentials' },
  };

  static ports = {
    apiKeys: ApiKeyRepository,
    token: AuthTokenService,
  };

  async execute({
    input,
    ports,
    errors,
  }: ExecuteCtx<typeof AuthenticateApiKey>) {
    const apiKey = await ports.apiKeys.getByKey(input.key);
    if (!apiKey) throw errors.INVALID_CREDENTIALS();

    const actor = {
      type: 'apiKey' as const,
      apiKeyId: apiKey.props.id,
      userId: apiKey.props.userId,
      organizationIds: [...apiKey.props.organizationIds],
    };

    return {
      actor,
      token: await ports.token.issue(actor),
    };
  }
}
