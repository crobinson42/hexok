import { ApiUseCase, type ExecuteCtx } from 'plinth/app';
import { z } from 'zod';
import { ApiKey, apiKeySchema } from '../../../domain/entities/api-key.js';
import { ApiKeyCreated } from '../../../domain/events/api-key.js';
import { DomainEvents } from '../../../domain/events/index.js';
import { requireUser } from '../../auth.js';
import type { AppContext } from '../../context.js';
import { ApiKeyRepository } from '../../ports/repos/api-keys-repo.js';
import { UserRepository } from '../../ports/repos/users-repo.js';

export class CreateApiKey extends ApiUseCase {
  static readonly key = 'apiKey.create';

  static input = z.object({
    id: z.string(),
    userId: z.string(),
    key: z.string(),
    organizationIds: z.array(z.string()).min(1),
  });

  static output = apiKeySchema;

  static errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
    FORBIDDEN: { message: 'Forbidden' },
    USER_NOT_FOUND: { message: 'User not found' },
    API_KEY_EXISTS: { message: 'API key already exists' },
    ORGANIZATION_NOT_ALLOWED: { message: 'Organization not allowed' },
  };

  static ports = {
    users: UserRepository,
    apiKeys: ApiKeyRepository,
  };

  static publishes = [DomainEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
    ctx,
  }: ExecuteCtx<typeof CreateApiKey, AppContext>) {
    requireUser(ctx, input.userId, errors);

    const user = await ports.users.get(input.userId);
    if (!user) throw errors.USER_NOT_FOUND();

    const allowed = new Set(user.props.organizationIds);
    for (const organizationId of input.organizationIds) {
      if (!allowed.has(organizationId)) throw errors.ORGANIZATION_NOT_ALLOWED();
    }

    const existingById = await ports.apiKeys.get(input.id);
    if (existingById) throw errors.API_KEY_EXISTS();

    const existingByKey = await ports.apiKeys.getByKey(input.key);
    if (existingByKey) throw errors.API_KEY_EXISTS();

    const apiKey = ApiKey.create({
      id: input.id,
      userId: user.props.id,
      key: input.key,
      organizationIds: input.organizationIds,
    });
    await ports.apiKeys.save(apiKey);

    publish(
      new ApiKeyCreated({
        ...apiKey.toProps(),
        organizationIds: [...apiKey.props.organizationIds],
      }),
    );

    return apiKey.toProps();
  }
}
