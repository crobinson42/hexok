import type { ExecuteCtx } from 'hexok/app';
import { z } from 'zod';
import { ApiKeyDeleted } from '../../../domain/events/domain/api-key.js';
import { DomainEvents } from '../../../domain/events/domain/catalog.js';
import { requireUser } from '../../auth.js';
import { AuthErrors } from '../../errors.js';
import {
  ApiKeyDeleted as ApiKeyDeletedClient,
  ClientEvents,
} from '../../events/client/catalog.js';
import { UserUseCase } from '../../guards.js';
import { ApiKeyRepository } from '../../ports/repos/api-keys.js';

export class DeleteApiKey extends UserUseCase {
  static readonly key = 'apiKey.delete';

  static input = z.object({
    id: z.string(),
  });

  static output = z.object({
    id: z.string(),
  });

  static errors = {
    ...AuthErrors,
    API_KEY_NOT_FOUND: { message: 'API key not found' },
  } as const;

  static ports = {
    apiKeys: ApiKeyRepository,
  };

  static publishes = [DomainEvents, ClientEvents] as const;

  async execute({
    input,
    ports,
    errors,
    publish,
    ctx,
  }: ExecuteCtx<typeof DeleteApiKey>) {
    const apiKey = await ports.apiKeys.get(input.id);
    if (!apiKey) throw errors.API_KEY_NOT_FOUND();

    requireUser(ctx, apiKey.props.userId, errors);

    await ports.apiKeys.delete(apiKey.props.id);

    publish(new ApiKeyDeleted({ id: apiKey.props.id }));
    publish(
      new ApiKeyDeletedClient(
        { id: apiKey.props.id },
        {
          kind: 'organization',
          organizationIds: [...apiKey.props.organizationIds],
        },
      ),
    );

    return { id: apiKey.props.id };
  }
}
