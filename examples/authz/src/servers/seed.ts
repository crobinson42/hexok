import type { Authz, Tuple } from '@hexok/authz';
import type { catalog } from '../app/authz/catalog.js';
import type { GroupRepository } from '../app/ports/repos/group-repository.js';
import type { LocationRepository } from '../app/ports/repos/location-repository.js';
import type { NoteRepository } from '../app/ports/repos/note-repository.js';
import type { OrgRepository } from '../app/ports/repos/org-repository.js';
import type { RegionRepository } from '../app/ports/repos/region-repository.js';
import type { ScanRepository } from '../app/ports/repos/scan-repository.js';
import { GroupEntity } from '../domain/entities/group.js';
import { LocationEntity } from '../domain/entities/location.js';
import { NoteEntity } from '../domain/entities/note.js';
import { OrgEntity } from '../domain/entities/org.js';
import { RegionEntity } from '../domain/entities/region.js';
import { ScanEntity } from '../domain/entities/scan.js';

/**
 * Sample company. Records and tuples are written as two steps.
 * Tuple order is the order `explain` walks when several tuples match.
 */
export async function seed(ports: {
  authz: Authz<typeof catalog>;
  orgs: OrgRepository;
  regions: RegionRepository;
  locations: LocationRepository;
  scans: ScanRepository;
  notes: NoteRepository;
  groups: GroupRepository;
}): Promise<void> {
  await ports.orgs.save(OrgEntity.create({ id: 'acme', name: 'Acme' }));
  await ports.orgs.save(OrgEntity.create({ id: 'other', name: 'Other' }));

  await ports.regions.save(
    RegionEntity.create({ id: 'west', name: 'West', orgId: 'acme' }),
  );
  await ports.regions.save(
    RegionEntity.create({ id: 'east', name: 'East', orgId: 'acme' }),
  );
  await ports.regions.save(
    RegionEntity.create({ id: 'other', name: 'Other', orgId: 'other' }),
  );

  await ports.locations.save(
    LocationEntity.create({
      id: 'gate-a',
      name: 'Gate A',
      parent: { type: 'region', id: 'west' },
    }),
  );
  await ports.locations.save(
    LocationEntity.create({
      id: 'gate-b',
      name: 'Gate B',
      parent: { type: 'region', id: 'west' },
    }),
  );
  await ports.locations.save(
    LocationEntity.create({
      id: 'gate-c',
      name: 'Gate C',
      parent: { type: 'region', id: 'east' },
    }),
  );
  await ports.locations.save(
    LocationEntity.create({
      id: 'hq',
      name: 'HQ',
      parent: { type: 'org', id: 'acme' },
    }),
  );
  await ports.locations.save(
    LocationEntity.create({
      id: 'foreign',
      name: 'Foreign',
      parent: { type: 'region', id: 'other' },
    }),
  );

  await ports.scans.save(
    ScanEntity.create({ id: '50', title: 'HQ', locationId: 'hq' }),
  );
  await ports.scans.save(
    ScanEntity.create({ id: '91', title: 'Gate A', locationId: 'gate-a' }),
  );
  await ports.scans.save(
    ScanEntity.create({ id: '92', title: 'Gate B', locationId: 'gate-b' }),
  );
  await ports.scans.save(
    ScanEntity.create({ id: '93', title: 'Gate C', locationId: 'gate-c' }),
  );
  await ports.scans.save(
    ScanEntity.create({ id: '7', title: 'Foreign', locationId: 'foreign' }),
  );

  await ports.notes.save(
    NoteEntity.create({
      id: '5',
      body: 'Gate A note',
      parent: { type: 'scan', id: '91' },
    }),
  );
  await ports.notes.save(
    NoteEntity.create({
      id: '6',
      body: 'Gate B note',
      parent: { type: 'scan', id: '92' },
    }),
  );

  await ports.groups.save(
    GroupEntity.create({ id: 'night-crew', name: 'Night crew' }),
  );
  await ports.groups.save(
    GroupEntity.create({ id: 'day-crew', name: 'Day crew' }),
  );
  await ports.groups.save(
    GroupEntity.create({ id: 'auditors', name: 'Auditors' }),
  );

  await ports.authz.write(tuples);
}

const tuples: readonly Tuple[] = [
  { object: 'group:night-crew', relation: 'member', subject: 'user:alice' },
  { object: 'group:day-crew', relation: 'member', subject: 'user:erin' },
  { object: 'group:night-crew', relation: 'member', subject: 'group:day-crew' },
  { object: 'org:acme', relation: 'member', subject: 'group:night-crew' },
  { object: 'org:acme', relation: 'member', subject: 'user:dave' },
  { object: 'region:west', relation: 'parent', subject: 'org:acme' },
  { object: 'region:east', relation: 'parent', subject: 'org:acme' },
  { object: 'region:other', relation: 'parent', subject: 'org:other' },
  { object: 'location:gate-a', relation: 'parent', subject: 'region:west' },
  { object: 'location:gate-b', relation: 'parent', subject: 'region:west' },
  { object: 'location:gate-c', relation: 'parent', subject: 'region:east' },
  { object: 'location:hq', relation: 'parent', subject: 'org:acme' },
  { object: 'location:foreign', relation: 'parent', subject: 'region:other' },
  { object: 'scan:50', relation: 'parent', subject: 'location:hq' },
  { object: 'scan:91', relation: 'parent', subject: 'location:gate-a' },
  { object: 'scan:92', relation: 'parent', subject: 'location:gate-b' },
  { object: 'scan:93', relation: 'parent', subject: 'location:gate-c' },
  { object: 'scan:7', relation: 'parent', subject: 'location:foreign' },
  { object: 'note:5', relation: 'parent', subject: 'scan:91' },
  { object: 'note:6', relation: 'parent', subject: 'scan:92' },
  { object: 'region:west', relation: 'viewer', subject: 'group:night-crew' },
  { object: 'location:gate-a', relation: 'viewer', subject: 'user:contractor' },
  { object: 'org:acme', relation: 'viewer', subject: 'user:helen' },
  { object: 'scan:92', relation: 'editor', subject: 'user:bob' },
  { object: 'region:east', relation: 'editor', subject: 'user:carol' },
  { object: 'scan:7', relation: 'viewer', subject: 'user:gina' },
  {
    object: 'region:east',
    relation: 'viewer',
    subject: 'group:auditors#member',
  },
  { object: 'group:auditors', relation: 'member', subject: 'user:frank' },
  {
    object: 'location:foreign',
    relation: 'viewer',
    subject: 'group:auditors#editor',
  },
  { object: 'org:acme', relation: 'editor', subject: 'user:ada' },
  { object: 'org:other', relation: 'editor', subject: 'user:ada' },
  { object: 'group:night-crew', relation: 'editor', subject: 'user:ada' },
];
