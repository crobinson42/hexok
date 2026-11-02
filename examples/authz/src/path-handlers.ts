import type { PathStore, Paths } from '@hexok/authz';
import { ObjectId } from 'mongodb';
import {
  LocationMoved,
  NoteCreated,
  NoteDeleted,
  ScanRecorded,
} from './domain.js';

/** One row per domain event. The app subscribes these like any other handler. */
export function pathHandlers(
  paths: Paths<{ places: PathStore; scans: PathStore }>,
) {
  return paths.handlers([
    paths.placeOn(
      ScanRecorded,
      (scan) => ({
        id: scan.id,
        parent: scan.locationId,
        // Scans use ObjectId `_id`s, so the join needs the same type.
        resourceId: new ObjectId(scan.id.slice('scan:'.length)),
      }),
      'scans',
    ),
    paths.placeOn(
      NoteCreated,
      (note) => ({ id: note.id, parent: note.parentId }),
      'scans',
    ),
    paths.moveOn(LocationMoved, (location) => ({
      id: location.id,
      parent: location.regionId,
    })),
    paths.removeOn(NoteDeleted, (note) => note.id),
  ]);
}
