import { bearerToken, type Sessions } from '@hexok/auth';
import { createImplementer } from '@ts-pf/server';
import type { ApiCtx, Caller } from '../../app/use-cases/context.js';
import { DomainError } from '../../domain/errors/domain.js';
import type { Api } from '../api.js';
import { apiContract } from './contract.js';
import { rpcErrors, toRpcError } from './errors.js';

/**
 * What the edge needs from sessions: who a token proves, and signing it out.
 * `Sessions` from `@hexok/auth` fits. Another provider fits by implementing
 * the same two methods.
 */
export type CallerSessions = Pick<Sessions<Caller>, 'authenticate' | 'close'>;

/**
 * Each request's context. `api` is what use cases receive. `signOut` ends the
 * session the request's token names. It stays at the edge, so no use case
 * sees a token or a session id.
 */
export type RpcCtx = {
  readonly api: ApiCtx;
  readonly signOut: () => Promise<void>;
};

/**
 * The request's context from an `Authorization: Bearer <token>` header. No
 * header is an anonymous caller. Another scheme, or a token that proves no
 * session, is `Unauthenticated` before any procedure runs. Every refusal
 * looks the same to the client.
 */
export function callerContext(sessions: CallerSessions) {
  return async (authorization: string | null | undefined): Promise<RpcCtx> => {
    if (authorization === null || authorization === undefined) {
      return { api: {}, signOut: async () => {} };
    }
    const token = bearerToken(authorization);
    const found = await sessions.authenticate(token);
    if (!found.ok) throw toRpcError(DomainError.Unauthenticated());
    return {
      api: { caller: found.value },
      signOut: () => sessions.close(token),
    };
  };
}

/** Each procedure calls one use case. The use case owns the rules. */
export function createApiApp(api: Api) {
  const impl = createImplementer(apiContract).$context<RpcCtx>();
  return impl.use(rpcErrors).router({
    posts: {
      save: impl.posts.save.handler(async ({ context, input }) =>
        (await api.savePost.execute(context.api, input)).toJSON(),
      ),
      publish: impl.posts.publish.handler(async ({ context, input }) =>
        (await api.publishPost.execute(context.api, input)).toJSON(),
      ),
      unpublish: impl.posts.unpublish.handler(async ({ context, input }) =>
        (await api.unpublishPost.execute(context.api, input)).toJSON(),
      ),
    },
    sessions: {
      // Sign out at the edge: the token names the session, and the caller does not.
      end: impl.sessions.end.handler(async ({ context }) => {
        if (context.api.caller === undefined) {
          throw DomainError.SignInRequired();
        }
        await context.signOut();
        return null;
      }),
    },
    subscribers: {
      subscribe: impl.subscribers.subscribe.handler(
        async ({ context, input }) =>
          (await api.subscribeToPosts.execute(context.api, input)).toJSON(),
      ),
    },
  });
}

export type ApiApp = ReturnType<typeof createApiApp>;
