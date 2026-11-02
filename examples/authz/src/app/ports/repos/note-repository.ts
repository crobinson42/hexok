import { Port } from 'hexok';
import type { NoteEntity } from '../../../domain/entities/note.js';

export abstract class NoteRepository extends Port('NoteRepository') {
  abstract get(id: string): Promise<NoteEntity | null>;
  abstract save(note: NoteEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract listByIds(ids: readonly string[]): Promise<readonly NoteEntity[]>;
}
