import type { Authz, Explanation } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { idSchema } from '../../../../../domain/schemas/id.js';
import {
  type Action,
  actionNamesList,
  type catalog,
} from '../../../../authz/catalog.js';
import { ApiUseCase } from '../../../context.js';

export const explainAccessInput = z.object({
  action: z.enum(actionNamesList),
  id: idSchema,
});

export type ExplainAccessInput = z.infer<typeof explainAccessInput>;

/** The first granting path. An empty `steps` array means deny. */
export class ExplainAccess extends ApiUseCase('access.explain', {
  input: explainAccessInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: ExplainAccessInput,
  ): Promise<Explanation> {
    return explain(this.deps.authz, ctx.actor, input.action, input.id);
  }
}

function explain(
  authz: Authz<typeof catalog>,
  actor: UseCase.Ctx<typeof ApiUseCase>['actor'],
  action: Action,
  id: string,
): Promise<Explanation> {
  switch (action) {
    case 'org:view':
    case 'org:edit':
      return authz.explain({ actor, action, resource: { type: 'org', id } });
    case 'region:view':
    case 'region:edit':
      return authz.explain({
        actor,
        action,
        resource: { type: 'region', id },
      });
    case 'location:view':
    case 'location:edit':
      return authz.explain({
        actor,
        action,
        resource: { type: 'location', id },
      });
    case 'scan:view':
    case 'scan:edit':
      return authz.explain({ actor, action, resource: { type: 'scan', id } });
    case 'note:view':
    case 'note:edit':
      return authz.explain({ actor, action, resource: { type: 'note', id } });
    case 'group:view':
    case 'group:edit':
      return authz.explain({ actor, action, resource: { type: 'group', id } });
    default:
      return unreachable(action);
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported value ${String(value)}.`);
}
