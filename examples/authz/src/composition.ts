import { Authz, type PathHandler, Paths, type Principals } from '@hexok/authz';
import { MongoPathStore, MongoPolicyStore } from '@hexok/authz-mongo';
import { Adapter } from 'hexok';
import type { Db } from 'mongodb';
import { Catalog } from './access.js';
import type { DomainEvent } from './domain.js';
import { pathHandlers } from './path-handlers.js';
import { Events } from './ports.js';
import { MongoLocations, MongoNotes, MongoScans } from './repositories.js';

/** Runs each subscribed handler before `publish` resolves. A worker would use a queue. */
class InProcessEvents extends Adapter(Events) {
  private handlers: readonly PathHandler[] = [];

  subscribe(handlers: readonly PathHandler[]): void {
    this.handlers = handlers;
  }

  override async publish(event: DomainEvent): Promise<void> {
    for (const handler of this.handlers) {
      if (handler.event.token === event.token) {
        await handler.handle(event as never);
      }
    }
  }
}

/** Each database is only ever used through its own stores. */
export async function compose(
  databases: {
    readonly authz: Db;
    readonly places: Db;
    readonly scans: Db;
  },
  principals: Principals,
) {
  const policies = new MongoPolicyStore({ db: databases.authz });
  const centralPaths = new MongoPathStore({ db: databases.authz });
  const placesPaths = new MongoPathStore({ db: databases.places });
  const scansPaths = new MongoPathStore({ db: databases.scans });
  const notes = new MongoNotes({ db: databases.scans });
  const scans = new MongoScans({ db: databases.scans });
  const locations = new MongoLocations({ db: databases.places });
  for (const adapter of [
    policies,
    centralPaths,
    placesPaths,
    scansPaths,
    notes,
  ]) {
    await adapter.start();
  }

  const authz = new Authz(
    { policies, paths: centralPaths, principals },
    { catalog: Catalog },
  );
  const paths = new Paths({
    central: centralPaths,
    copies: { places: placesPaths, scans: scansPaths },
  });
  const events = new InProcessEvents();
  events.subscribe(pathHandlers(paths));

  return { authz, paths, policies, notes, scans, locations, events };
}
