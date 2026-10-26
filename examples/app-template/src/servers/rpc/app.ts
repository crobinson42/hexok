import type { Broadcast } from '@hexok/broadcast';
import { createImplementer } from '@ts-pf/server';
import type { ApiCtx } from '../../app/use-cases/context.js';
import type { Api } from '../api.js';
import { clientEventStream } from './client-events.js';
import { apiContract, eventsContract } from './contract.js';
import { rpcErrors } from './errors.js';

/** The caller's context from an `Authorization` header. */
export function callerContext(
  authorization: string | null | undefined,
): ApiCtx {
  return authorization ? { authToken: authorization } : {};
}

/** Each procedure calls one use case. The use case owns the rules. */
export function createApiApp(api: Api) {
  const impl = createImplementer(apiContract).$context<ApiCtx>();
  return impl.use(rpcErrors).router({
    posts: {
      save: impl.posts.save.handler(async ({ context, input }) =>
        (await api.savePost.execute(context, input)).toJSON(),
      ),
      publish: impl.posts.publish.handler(async ({ context, input }) =>
        (await api.publishPost.execute(context, input)).toJSON(),
      ),
      unpublish: impl.posts.unpublish.handler(async ({ context, input }) =>
        (await api.unpublishPost.execute(context, input)).toJSON(),
      ),
    },
    subscribers: {
      subscribe: impl.subscribers.subscribe.handler(
        async ({ context, input }) =>
          (await api.subscribeToPosts.execute(context, input)).toJSON(),
      ),
    },
  });
}

/** `subscribe` streams client events from the broadcast until the client stops. */
export function createEventsApp(broadcast: Broadcast) {
  const impl = createImplementer(eventsContract).$context<ApiCtx>();
  return impl.router({
    subscribe: impl.subscribe.handler(({ input }) =>
      clientEventStream(broadcast, input.events),
    ),
  });
}

export type ApiApp = ReturnType<typeof createApiApp>;
export type EventsApp = ReturnType<typeof createEventsApp>;
