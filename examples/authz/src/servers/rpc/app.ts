import { createImplementer } from '@ts-pf/server';
import { actorFromHeader } from '../../app/authz/actor.js';
import type { ApiCtx } from '../../app/use-cases/context.js';
import type { Api } from '../api.js';
import { apiContract } from './contract.js';
import { rpcErrors, toRpcError } from './errors.js';

/**
 * The actor from the `x-actor` header. A missing header is `ActorRequired`.
 * An empty type or id is `ActorInvalid`. Both happen before any procedure runs.
 */
export function actorContext(
  header: string | null | undefined,
): Promise<ApiCtx> {
  try {
    return Promise.resolve({ actor: actorFromHeader(header ?? null) });
  } catch (error) {
    throw toRpcError(error);
  }
}

/** Each procedure calls one use case. The use case owns the rules. */
export function createApiApp(api: Api) {
  const impl = createImplementer(apiContract).$context<ApiCtx>();
  return impl.use(rpcErrors).router({
    scans: {
      list: impl.scans.list.handler(async ({ context, input }) =>
        (await api.listScans.execute(context, input)).map((scan) =>
          scan.toJSON(),
        ),
      ),
      get: impl.scans.get.handler(async ({ context, input }) =>
        (await api.getScan.execute(context, input)).toJSON(),
      ),
      create: impl.scans.create.handler(async ({ context, input }) =>
        (await api.createScan.execute(context, input)).toJSON(),
      ),
      update: impl.scans.update.handler(async ({ context, input }) =>
        (await api.updateScan.execute(context, input)).toJSON(),
      ),
    },
    notes: {
      list: impl.notes.list.handler(async ({ context, input }) =>
        (await api.listNotes.execute(context, input)).map((note) =>
          note.toJSON(),
        ),
      ),
      get: impl.notes.get.handler(async ({ context, input }) =>
        (await api.getNote.execute(context, input)).toJSON(),
      ),
      create: impl.notes.create.handler(async ({ context, input }) =>
        (await api.createNote.execute(context, input)).toJSON(),
      ),
    },
    locations: {
      list: impl.locations.list.handler(async ({ context, input }) =>
        (await api.listLocations.execute(context, input)).map((location) =>
          location.toJSON(),
        ),
      ),
      get: impl.locations.get.handler(async ({ context, input }) =>
        (await api.getLocation.execute(context, input)).toJSON(),
      ),
      create: impl.locations.create.handler(async ({ context, input }) =>
        (await api.createLocation.execute(context, input)).toJSON(),
      ),
    },
    regions: {
      create: impl.regions.create.handler(async ({ context, input }) =>
        (await api.createRegion.execute(context, input)).toJSON(),
      ),
    },
    groups: {
      list: impl.groups.list.handler(async ({ context, input }) =>
        (await api.listGroups.execute(context, input)).map((group) =>
          group.toJSON(),
        ),
      ),
      get: impl.groups.get.handler(async ({ context, input }) =>
        (await api.getGroup.execute(context, input)).toJSON(),
      ),
      create: impl.groups.create.handler(async ({ context, input }) =>
        (await api.createGroup.execute(context, input)).toJSON(),
      ),
      addMember: impl.groups.addMember.handler(async ({ context, input }) =>
        api.addMember.execute(context, input),
      ),
      removeMember: impl.groups.removeMember.handler(
        async ({ context, input }) => api.removeMember.execute(context, input),
      ),
    },
    shares: {
      grant: impl.shares.grant.handler(async ({ context, input }) =>
        api.grantShare.execute(context, input),
      ),
      revoke: impl.shares.revoke.handler(async ({ context, input }) =>
        api.revokeShare.execute(context, input),
      ),
    },
    access: {
      explain: impl.access.explain.handler(async ({ context, input }) => {
        const explanation = await api.explainAccess.execute(context, input);
        return {
          allowed: explanation.allowed,
          action: explanation.action,
          resource: explanation.resource,
          actor: explanation.actor,
          steps: explanation.steps.map((step) => ({
            object: step.object,
            relation: step.relation,
            subject: step.subject,
            via: step.via,
          })),
        };
      }),
    },
  });
}

export type ApiApp = ReturnType<typeof createApiApp>;
