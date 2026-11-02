import type { Tuple } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { ApiUseCase } from '../../../context.js';
import { type ShareInput, shareInput } from '../../share-input.js';
import { type ShareDeps, shareTuple } from '../../share-tuple.js';

export type RevokeShareInput = ShareInput;

/** Delete a viewer or editor tuple. */
export class RevokeShare extends ApiUseCase('share.revoke', {
  input: shareInput,
}) {
  constructor(private readonly deps: ShareDeps) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: RevokeShareInput,
  ): Promise<Tuple> {
    const tuple = await shareTuple(this.deps, ctx.actor, input);
    await this.deps.authz.delete(tuple);
    return tuple;
  }
}
