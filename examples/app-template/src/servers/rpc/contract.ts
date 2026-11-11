import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { publishPostInput } from '../../app/use-cases/posts/api/command/publish-post.js';
import { savePostInput } from '../../app/use-cases/posts/api/command/save-post.js';
import { unpublishPostInput } from '../../app/use-cases/posts/api/command/unpublish-post.js';
import { subscribeToPostsInput } from '../../app/use-cases/subscribers/api/command/subscribe.js';
import { postSchema } from '../../domain/schemas/post.js';
import { subscriberSchema } from '../../domain/schemas/subscriber.js';
import { clientErrors } from './errors.js';

/**
 * The API. HTTP serves it at `/rpc`, such as `POST /rpc/posts/save`.
 * Inputs are the use case schemas. Every procedure declares the same
 * client-facing domain errors. The use case decides which one it throws.
 */
const call = procedure.errors(clientErrors);

export const apiContract = router({
  posts: {
    save: call.input(savePostInput).output(postSchema),
    publish: call.input(publishPostInput).output(postSchema),
    unpublish: call.input(unpublishPostInput).output(postSchema),
  },
  sessions: {
    end: call.input(z.object({})).output(z.null()),
  },
  subscribers: {
    subscribe: call.input(subscribeToPostsInput).output(subscriberSchema),
  },
});
