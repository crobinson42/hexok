import type { AccessFilter } from '@hexok/authz';
import { Port } from 'hexok';
import type { DomainEvent, Location, Note, Scan } from './domain.js';

export abstract class Locations extends Port('Locations') {
  abstract get(id: string): Promise<Location>;
  abstract save(location: Location): Promise<void>;
}

export abstract class Scans extends Port('Scans') {
  abstract save(scan: Scan): Promise<void>;
  abstract list(query: { access: AccessFilter }): Promise<readonly Scan[]>;
}

export abstract class Notes extends Port('Notes') {
  abstract get(id: string): Promise<Note>;
  abstract save(note: Note): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract list(query: {
    parentId: string;
    access: AccessFilter;
  }): Promise<readonly Note[]>;
}

export abstract class Events extends Port('Events') {
  abstract publish(event: DomainEvent): Promise<void>;
}
