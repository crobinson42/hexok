import { createImplementer } from '@ts-pf/server';
import type { Authenticator } from '../../app/ports/auth/authenticator.js';
import type { ApiCtx } from '../../app/use-cases/context.js';
import { DomainError } from '../../domain/errors/domain.js';
import type { Api } from '../api.js';
import { apiContract } from './contract.js';
import { rpcErrors, toRpcError } from './errors.js';

/**
 * The caller's context from an `Authorization: Bearer <token>` header. No
 * header is an anonymous caller. Another scheme, or a token the
 * authenticator rejects, is `Unauthenticated` before any procedure runs.
 */
export function callerContext(authenticator: Authenticator) {
  return async (authorization: string | null | undefined): Promise<ApiCtx> => {
    if (authorization === null || authorization === undefined) return {};
    const token = /^Bearer (.+)$/i.exec(authorization)?.[1];
    const caller =
      token === undefined ? null : await authenticator.authenticate(token);
    if (caller === null) throw toRpcError(DomainError.Unauthenticated());
    return { caller };
  };
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
    sessions: {
      end: impl.sessions.end.handler(async ({ context, input }) => {
        await api.endSession.execute(context, input);
        return null;
      }),
    },
    subscribers: {
      subscribe: impl.subscribers.subscribe.handler(
        async ({ context, input }) =>
          (await api.subscribeToPosts.execute(context, input)).toJSON(),
      ),
    },
  });
}

export type ApiApp = ReturnType<typeof createApiApp>;
