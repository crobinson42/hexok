import { Entity, Errors, Event } from 'hexok';
import { z } from 'zod';

export class ExampleError extends Errors('example', {
  BlankBody: { message: 'A note needs a body' },
  Missing: { message: 'Not found' },
}) {}

export const LocationSchema = z.object({
  id: z.string(),
  regionId: z.string(),
});

export class Location extends Entity('Location', LocationSchema) {
  moveTo(regionId: string): this {
    return this.set((draft) => {
      draft.regionId = regionId;
    });
  }
}

export const ScanSchema = z.object({
  /** `scan:<hex>`. The hex is the document's ObjectId. */
  id: z.string(),
  code: z.string(),
  locationId: z.string(),
});

export class Scan extends Entity('Scan', ScanSchema) {}

export const NoteSchema = z.object({
  id: z.string(),
  parentId: z.string(),
  body: z.string(),
  updatedAt: z.date(),
});

/** Domain rules live here. Authz never sees a note's body. */
export class Note extends Entity('Note', NoteSchema) {
  edit(body: string, now: Date): this {
    if (body.trim() === '') throw ExampleError.BlankBody();
    return this.set((draft) => {
      draft.body = body;
      draft.updatedAt = now;
    });
  }
}

export class LocationMoved extends Event('location.moved', LocationSchema) {}
export class ScanRecorded extends Event('scan.recorded', ScanSchema) {}
export class NoteCreated extends Event('note.created', NoteSchema) {}
export class NoteDeleted extends Event(
  'note.deleted',
  z.object({ id: z.string() }),
) {}

export type DomainEvent =
  | LocationMoved
  | ScanRecorded
  | NoteCreated
  | NoteDeleted;
