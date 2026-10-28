import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { publishPostInput } from '../../app/use-cases/posts/api/command/publish-post.js';
import { savePostInput } from '../../app/use-cases/posts/api/command/save-post.js';
import { unpublishPostInput } from '../../app/use-cases/posts/api/command/unpublish-post.js';
import { endSessionInput } from '../../app/use-cases/sessions/api/command/end-session.js';
import { subscribeToPostsInput } from '../../app/use-cases/subscribers/api/command/subscribe.js';
import { postSchema } from '../../domain/schemas/post.js';
import { subscriberSchema } from '../../domain/schemas/subscriber.js';
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
  sessions: {
    end: procedure
      .input(endSessionInput)
      .output(z.null())
      .errors(declared('SignInRequired')),
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
