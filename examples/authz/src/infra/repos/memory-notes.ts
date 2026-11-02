import { Adapter } from 'hexok';
import { NoteRepository } from '../../app/ports/repos/note-repository.js';
import { NoteEntity } from '../../domain/entities/note.js';
import { rowTable } from './row-table.js';

export class MemoryNotes extends Adapter(NoteRepository) {
  readonly #rows = rowTable<ReturnType<NoteEntity['toProps']>, NoteEntity>(
    (props) => NoteEntity.restore(props),
  );

  override async get(id: string): Promise<NoteEntity | null> {
    return this.#rows.get(id);
  }

  override async save(note: NoteEntity): Promise<void> {
    this.#rows.save(note);
  }

  override async delete(id: string): Promise<void> {
    this.#rows.delete(id);
  }

  override async listByIds(
    ids: readonly string[],
  ): Promise<readonly NoteEntity[]> {
    return this.#rows.listByIds(ids);
  }
}
