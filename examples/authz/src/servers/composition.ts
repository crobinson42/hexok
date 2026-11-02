import { Authz, MemoryTupleStore } from '@hexok/authz';
import { catalog } from '../app/authz/catalog.js';
import { MemoryGroups } from '../infra/repos/memory-groups.js';
import { MemoryLocations } from '../infra/repos/memory-locations.js';
import { MemoryNotes } from '../infra/repos/memory-notes.js';
import { MemoryOrgs } from '../infra/repos/memory-orgs.js';
import { MemoryRegions } from '../infra/repos/memory-regions.js';
import { MemoryScans } from '../infra/repos/memory-scans.js';
import { seed } from './seed.js';

/** In-memory records and tuples. They live for the life of the process. */
export async function createRuntime() {
  const orgs = new MemoryOrgs();
  const regions = new MemoryRegions();
  const locations = new MemoryLocations();
  const scans = new MemoryScans();
  const notes = new MemoryNotes();
  const groups = new MemoryGroups();
  const authz = new Authz(catalog, new MemoryTupleStore());
  await seed({ authz, orgs, regions, locations, scans, notes, groups });
  return { authz, orgs, regions, locations, scans, notes, groups };
}

export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
