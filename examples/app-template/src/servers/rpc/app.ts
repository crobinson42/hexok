import { bearerToken } from '@hexok/auth';
import type { Logger } from '@hexok/logger';
import { createImplementer } from '@ts-pf/server';
import type { ApiCtx, PublicApiCtx } from '../../app/use-cases/context.js';
import { DomainError } from '../../domain/errors/domain.js';
import type { SessionJwt } from '../../infra/auth/jwt-sessions.js';
import type { Api } from '../api.js';
import { apiContract } from './contract.js';
import { rpcErrors, toRpcError } from './errors.js';

/**
 * Each request's facts. `api` is what use cases receive. `token` is the
 * bearer JWT, present only after `fromJwt` accepted it. Use cases do not
 * see it. Login and logout use the injected `SessionJwt`, not this bag.
 */
export type RpcCtx = {
  readonly api: PublicApiCtx;
  readonly token?: string;
};

/** The family guard is the runtime check. This only satisfies `ApiCtx`. */
function signedIn(ctx: PublicApiCtx): ApiCtx {
  return ctx as ApiCtx;
}

/**
 * The request's context from an `Authorization: Bearer <token>` header. No
 * header is an anonymous caller. Another scheme, or a JWT that proves no
 * session, is `Unauthenticated` before any procedure runs. Every refusal
 * looks the same to the client. The refusal code is logged and is not sent.
 */
export function callerContext(sessions: SessionJwt, logger: Logger) {
  return async (authorization: string | null | undefined): Promise<RpcCtx> => {
    if (authorization === null || authorization === undefined) {
      return { api: {} };
    }
    const token = bearerToken(authorization);
    const found = await sessions.fromJwt(token);
    if (!found.ok) {
      logger.warn('authentication refused', { code: found.code });
      throw toRpcError(DomainError.Unauthenticated());
    }
    return token === undefined
      ? { api: { caller: found.value } }
      : { api: { caller: found.value }, token };
  };
}

/** Each procedure calls one use case. Login and logout also use `sessions`. */
export function createApiApp(api: Api, sessions: SessionJwt) {
  const impl = createImplementer(apiContract).$context<RpcCtx>();
  return impl.use(rpcErrors).router({
    auth: {
      login: impl.auth.login.handler(async ({ context, input }) => {
        const caller = await api.login.execute(context.api, input);
        return { token: await sessions.toJwt(caller) };
      }),
      logout: impl.auth.logout.handler(async ({ context, input }) => {
        await api.logout.execute(signedIn(context.api), input);
        await sessions.revoke(context.token);
        return null;
      }),
      whoAmI: impl.auth.whoAmI.handler(async ({ context, input }) =>
        (await api.whoAmI.execute(signedIn(context.api), input)).toJSON(),
      ),
    },
    users: {
      create: impl.users.create.handler(async ({ context, input }) =>
        (await api.createUser.execute(context.api, input)).toJSON(),
      ),
      get: impl.users.get.handler(async ({ context, input }) =>
        (await api.getUser.execute(signedIn(context.api), input)).toJSON(),
      ),
    },
    organizations: {
      create: impl.organizations.create.handler(async ({ context, input }) =>
        (
          await api.createOrganization.execute(signedIn(context.api), input)
        ).toJSON(),
      ),
      addMember: impl.organizations.addMember.handler(
        async ({ context, input }) =>
          (await api.addMember.execute(signedIn(context.api), input)).toJSON(),
      ),
      listMine: impl.organizations.listMine.handler(
        async ({ context, input }) =>
          (await api.listMine.execute(signedIn(context.api), input)).map(
            (organization) => organization.toJSON(),
          ),
      ),
    },
    posts: {
      save: impl.posts.save.handler(async ({ context, input }) =>
        (await api.savePost.execute(signedIn(context.api), input)).toJSON(),
      ),
      publish: impl.posts.publish.handler(async ({ context, input }) =>
        (await api.publishPost.execute(signedIn(context.api), input)).toJSON(),
      ),
      unpublish: impl.posts.unpublish.handler(async ({ context, input }) =>
        (
          await api.unpublishPost.execute(signedIn(context.api), input)
        ).toJSON(),
      ),
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
