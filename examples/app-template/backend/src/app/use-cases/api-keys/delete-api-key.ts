import { ApiUseCase, type ExecuteCtx } from 'kerf/app';
import { z } from 'zod';
import { ApiKeyDeleted } from '../../../domain/events/api-key.js';
import { DomainEvents } from '../../../domain/events/index.js';
import { requireUser } from '../../auth.js';
import type { AppContext } from '../../context.js';
import {
  ApiKeyDeleted as ApiKeyDeletedClient,
  ClientEvents,
} from '../../events/client/index.js';
import { ApiKeyRepository } from '../../ports/repos/api-keys-repo.js';

export class DeleteApiKey extends ApiUseCase {
  static readonly key = 'apiKey.delete';

  static input = z.object({
    id: z.string(),
  });

  static output = z.object({
    id: z.string(),
  });

  static errors = {
    UNAUTHORIZED: { message: 'Unauthorized' },
    FORBIDDEN: { message: 'Forbidden' },
    API_KEY_NOT_FOUND: { message: 'API key not found' },
  };

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
  }: ExecuteCtx<typeof DeleteApiKey, AppContext>) {
    if (!ctx.actor) throw errors.UNAUTHORIZED();

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
