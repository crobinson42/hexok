import { randomUUID } from 'node:crypto';
import {
  type Authorize,
  authorizeGuard,
  type RequestAuthz,
} from '@hexok/authz';
import { UseCase } from 'hexok';
import { ObjectId } from 'mongodb';
import type { Action } from './access.js';
import {
  LocationMoved,
  Note,
  NoteCreated,
  NoteDeleted,
  Scan,
  ScanRecorded,
} from './domain.js';
import type { Events, Locations, Notes, Scans } from './ports.js';

/** Every member declares `authorize`. Forgetting it is a compile error. */
export const AppUseCase = UseCase.context<
  { authz: RequestAuthz<Action> },
  { authorize: Authorize<Action> }
>().guard(authorizeGuard);

type Ctx = UseCase.Ctx<typeof AppUseCase>;

export class MoveLocation extends AppUseCase('location.move', {
  authorize: {
    action: 'location:manage',
    resource: (input: { id: string }) => input.id,
  },
}) {
  constructor(private readonly deps: { locations: Locations; events: Events }) {
    super();
  }

  async execute(ctx: Ctx, input: { id: string; regionId: string }) {
    await ctx.authz.require('location:manage', input.regionId);
    const location = await this.deps.locations.get(input.id);
    location.moveTo(input.regionId);
    await this.deps.locations.save(location);
    await this.deps.events.publish(new LocationMoved(location.toProps()));
  }
}

export class RecordScan extends AppUseCase('scan.record', {
  authorize: {
    action: 'scan:create',
    resource: (input: { locationId: string }) => input.locationId,
  },
}) {
  constructor(private readonly deps: { scans: Scans; events: Events }) {
    super();
  }

  async execute(_ctx: Ctx, input: { code: string; locationId: string }) {
    const scan = Scan.create({
      id: `scan:${new ObjectId().toHexString()}`,
      ...input,
    });
    await this.deps.scans.save(scan);
    await this.deps.events.publish(new ScanRecorded(scan.toProps()));
    return scan.toProps();
  }
}

export class ListScans extends AppUseCase('scan.list', { authorize: null }) {
  constructor(private readonly deps: { scans: Scans }) {
    super();
  }

  async execute({ authz }: Ctx) {
    const access = await authz.filter('scan:read');
    const scans = await this.deps.scans.list({ access });
    return scans.map((scan) => scan.toProps());
  }
}

export class CreateNote extends AppUseCase('note.create', {
  // A new note has no path yet, so this checks its parent.
  authorize: {
    action: 'note:create',
    resource: (input: { parentId: string }) => input.parentId,
  },
}) {
  constructor(private readonly deps: { notes: Notes; events: Events }) {
    super();
  }

  async execute(_ctx: Ctx, input: { parentId: string; body: string }) {
    const note = Note.create({
      id: `note:${randomUUID()}`,
      parentId: input.parentId,
      body: '',
      updatedAt: new Date(),
    });
    note.edit(input.body, new Date());
    await this.deps.notes.save(note);
    await this.deps.events.publish(new NoteCreated(note.toProps()));
    return note.toProps();
  }
}

export class EditNote extends AppUseCase('note.edit', {
  authorize: {
    action: 'note:edit',
    resource: (input: { id: string }) => input.id,
  },
}) {
  constructor(private readonly deps: { notes: Notes }) {
    super();
  }

  async execute(_ctx: Ctx, input: { id: string; body: string }) {
    const note = await this.deps.notes.get(input.id);
    note.edit(input.body, new Date());
    await this.deps.notes.save(note);
    return note.toProps();
  }
}

export class DeleteNote extends AppUseCase('note.delete', {
  authorize: {
    action: 'note:delete',
    resource: (input: { id: string }) => input.id,
  },
}) {
  constructor(private readonly deps: { notes: Notes; events: Events }) {
    super();
  }

  async execute(_ctx: Ctx, input: { id: string }) {
    await this.deps.notes.delete(input.id);
    await this.deps.events.publish(new NoteDeleted({ id: input.id }));
  }
}

export class ListNotes extends AppUseCase('note.list', { authorize: null }) {
  constructor(private readonly deps: { notes: Notes }) {
    super();
  }

  async execute({ authz }: Ctx, input: { parentId: string }) {
    const access = await authz.filter('note:read');
    const notes = await this.deps.notes.list({ ...input, access });
    return notes.map((note) => note.toProps());
  }
}
