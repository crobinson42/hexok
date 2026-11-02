import type { Tuple } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { ApiUseCase } from '../../../context.js';
import { type ShareInput, shareInput } from '../../share-input.js';
import { type ShareDeps, shareTuple } from '../../share-tuple.js';

export type GrantShareInput = ShareInput;

/** Write a viewer or editor tuple. A second write of the same tuple stores it once. */
export class GrantShare extends ApiUseCase('share.grant', {
  input: shareInput,
}) {
  constructor(private readonly deps: ShareDeps) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: GrantShareInput,
  ): Promise<Tuple> {
    const tuple = await shareTuple(this.deps, ctx.actor, input);
    await this.deps.authz.write(tuple);
    return tuple;
  }
}
