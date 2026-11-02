import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { NoteEntity } from '../../../../../domain/entities/note.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { NoteRepository } from '../../../../ports/repos/note-repository.js';
import { ApiUseCase } from '../../../context.js';

export const listNotesInput = z.object({});

export type ListNotesInput = z.infer<typeof listNotesInput>;

/** Ids from `note:view`, then those note records. */
export class ListNotes extends ApiUseCase('note.list', {
  input: listNotesInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      notes: NoteRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    _input: ListNotesInput,
  ): Promise<readonly NoteEntity[]> {
    const ids = await this.deps.authz.list({
      actor: ctx.actor,
      action: 'note:view',
      type: 'note',
    });
    return this.deps.notes.listByIds(ids);
  }
}
