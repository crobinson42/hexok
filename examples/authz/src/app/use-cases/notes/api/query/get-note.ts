import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import type { NoteEntity } from '../../../../../domain/entities/note.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema } from '../../../../../domain/schemas/id.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { NoteRepository } from '../../../../ports/repos/note-repository.js';
import { ApiUseCase } from '../../../context.js';

export const getNoteInput = z.object({
  id: idSchema,
});

export type GetNoteInput = z.infer<typeof getNoteInput>;

/** `note:view` runs before the record is loaded. */
export class GetNote extends ApiUseCase('note.get', {
  input: getNoteInput,
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
    input: GetNoteInput,
  ): Promise<NoteEntity> {
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'note:view',
      resource: { type: 'note', id: input.id },
    });
    if (!allowed) throw DomainError.Forbidden();
    const note = await this.deps.notes.get(input.id);
    if (note === null) {
      throw DomainError.NotFound({ type: 'note', id: input.id });
    }
    return note;
  }
}
