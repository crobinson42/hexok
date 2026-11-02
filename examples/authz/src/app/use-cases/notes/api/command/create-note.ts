import type { Authz } from '@hexok/authz';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { NoteEntity } from '../../../../../domain/entities/note.js';
import { DomainError } from '../../../../../domain/errors/domain.js';
import { idSchema, textSchema } from '../../../../../domain/schemas/id.js';
import { noteParentSchema } from '../../../../../domain/schemas/note.js';
import type { catalog } from '../../../../authz/catalog.js';
import type { LocationRepository } from '../../../../ports/repos/location-repository.js';
import type { NoteRepository } from '../../../../ports/repos/note-repository.js';
import type { ScanRepository } from '../../../../ports/repos/scan-repository.js';
import { ApiUseCase } from '../../../context.js';
import { writeTuple } from '../../../write-tuple.js';

export const createNoteInput = z.object({
  id: idSchema,
  body: textSchema,
  parent: noteParentSchema,
});

export type CreateNoteInput = z.infer<typeof createNoteInput>;

/** The parent must exist, then the actor must pass that parent's edit action. */
export class CreateNote extends ApiUseCase('note.create', {
  input: createNoteInput,
}) {
  constructor(
    private readonly deps: {
      authz: Authz<typeof catalog>;
      scans: ScanRepository;
      locations: LocationRepository;
      notes: NoteRepository;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    input: CreateNoteInput,
  ): Promise<NoteEntity> {
    await this.#requireParentEdit(ctx, input.parent);
    if ((await this.deps.notes.get(input.id)) !== null) {
      throw DomainError.AlreadyExists({ type: 'note', id: input.id });
    }
    const note = NoteEntity.create({
      id: input.id,
      body: input.body,
      parent: input.parent,
    });
    await this.deps.notes.save(note);
    await writeTuple(
      this.deps.authz,
      {
        object: `note:${note.props.id}`,
        relation: 'parent',
        subject: `${note.props.parent.type}:${note.props.parent.id}`,
      },
      () => this.deps.notes.delete(note.props.id),
    );
    return note;
  }

  async #requireParentEdit(
    ctx: UseCase.Ctx<typeof ApiUseCase>,
    parent: CreateNoteInput['parent'],
  ): Promise<void> {
    if (parent.type === 'scan') {
      if ((await this.deps.scans.get(parent.id)) === null) {
        throw DomainError.NotFound({ type: 'scan', id: parent.id });
      }
      const allowed = await this.deps.authz.check({
        actor: ctx.actor,
        action: 'scan:edit',
        resource: { type: 'scan', id: parent.id },
      });
      if (!allowed) throw DomainError.Forbidden();
      return;
    }
    if ((await this.deps.locations.get(parent.id)) === null) {
      throw DomainError.NotFound({ type: 'location', id: parent.id });
    }
    const allowed = await this.deps.authz.check({
      actor: ctx.actor,
      action: 'location:edit',
      resource: { type: 'location', id: parent.id },
    });
    if (!allowed) throw DomainError.Forbidden();
  }
}
