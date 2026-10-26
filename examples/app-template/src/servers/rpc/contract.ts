import { procedure, router } from '@ts-pf/contract';
import { stream } from '@ts-pf/stream';
import { z } from 'zod';
import { publishPostInput } from '../../app/use-cases/posts/api/command/publish-post.js';
import { savePostInput } from '../../app/use-cases/posts/api/command/save-post.js';
import { unpublishPostInput } from '../../app/use-cases/posts/api/command/unpublish-post.js';
import { subscribeToPostsInput } from '../../app/use-cases/subscribers/api/command/subscribe.js';
import { postSchema } from '../../domain/schemas/post.js';
import { subscriberSchema } from '../../domain/schemas/subscriber.js';
import { type ClientEventMessage, clientEventKeys } from './client-events.js';
import { declared } from './errors.js';

/**
 * The API. HTTP serves it at `/rpc`, such as `POST /rpc/posts/save`.
 * Inputs are the use case schemas. Errors are the domain errors each
 * procedure can throw.
 */
export const apiContract = router({
  posts: {
    save: procedure
      .input(savePostInput)
      .output(postSchema)
      .errors(declared('PostNotFound')),
    publish: procedure
      .input(publishPostInput)
      .output(postSchema)
      .errors(declared('PostNotFound', 'AlreadyPublished', 'PublishAtInvalid')),
    unpublish: procedure
      .input(unpublishPostInput)
      .output(postSchema)
      .errors(declared('PostNotFound', 'NotPublished')),
  },
  subscribers: {
    subscribe: procedure
      .input(subscribeToPostsInput)
      .output(subscriberSchema)
      .errors(
        declared('ChannelsRequired', 'ChannelsInvalid', 'SmsRequiresPhone'),
      ),
  },
});

/**
 * Client events as a stream of `{ key, payload }`. HTTP serves it at
 * `/events` as server-sent events, and the websocket server serves it too.
 * `ClientEvents` is the contract: a new event there is a new key here.
 * The server sends messages the catalog already parsed, so the output is
 * typed, not checked again.
 */
export const eventsContract = router({
  subscribe: procedure
    .input(
      z.object({
        events: z.array(z.enum(clientEventKeys)).min(1).optional(),
      }),
    )
    .output(stream(z.custom<ClientEventMessage>())),
});
