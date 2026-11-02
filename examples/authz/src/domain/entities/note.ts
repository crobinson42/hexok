import { Entity } from 'hexok';
import { NoteSchema } from '../schemas/note.js';

export class NoteEntity extends Entity('Note', NoteSchema) {}
