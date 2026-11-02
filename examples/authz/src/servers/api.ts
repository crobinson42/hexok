import type { Authz } from '@hexok/authz';
import type { catalog } from '../app/authz/catalog.js';
import type { GroupRepository } from '../app/ports/repos/group-repository.js';
import type { LocationRepository } from '../app/ports/repos/location-repository.js';
import type { NoteRepository } from '../app/ports/repos/note-repository.js';
import type { OrgRepository } from '../app/ports/repos/org-repository.js';
import type { RegionRepository } from '../app/ports/repos/region-repository.js';
import type { ScanRepository } from '../app/ports/repos/scan-repository.js';
import { ExplainAccess } from '../app/use-cases/access/api/query/explain-access.js';
import { AddMember } from '../app/use-cases/groups/api/command/add-member.js';
import { CreateGroup } from '../app/use-cases/groups/api/command/create-group.js';
import { RemoveMember } from '../app/use-cases/groups/api/command/remove-member.js';
import { GetGroup } from '../app/use-cases/groups/api/query/get-group.js';
import { ListGroups } from '../app/use-cases/groups/api/query/list-groups.js';
import { CreateLocation } from '../app/use-cases/locations/api/command/create-location.js';
import { GetLocation } from '../app/use-cases/locations/api/query/get-location.js';
import { ListLocations } from '../app/use-cases/locations/api/query/list-locations.js';
import { CreateNote } from '../app/use-cases/notes/api/command/create-note.js';
import { GetNote } from '../app/use-cases/notes/api/query/get-note.js';
import { ListNotes } from '../app/use-cases/notes/api/query/list-notes.js';
import { CreateRegion } from '../app/use-cases/regions/api/command/create-region.js';
import { CreateScan } from '../app/use-cases/scans/api/command/create-scan.js';
import { UpdateScan } from '../app/use-cases/scans/api/command/update-scan.js';
import { GetScan } from '../app/use-cases/scans/api/query/get-scan.js';
import { ListScans } from '../app/use-cases/scans/api/query/list-scans.js';
import { GrantShare } from '../app/use-cases/shares/api/command/grant-share.js';
import { RevokeShare } from '../app/use-cases/shares/api/command/revoke-share.js';

export type ApiPorts = {
  authz: Authz<typeof catalog>;
  orgs: OrgRepository;
  regions: RegionRepository;
  locations: LocationRepository;
  scans: ScanRepository;
  notes: NoteRepository;
  groups: GroupRepository;
};

/** The API use cases, built from ports. RPC and tests call these. */
export function createApi(ports: ApiPorts) {
  const records = {
    authz: ports.authz,
    orgs: ports.orgs,
    regions: ports.regions,
    locations: ports.locations,
    scans: ports.scans,
    notes: ports.notes,
    groups: ports.groups,
  };
  return {
    listScans: new ListScans({ authz: ports.authz, scans: ports.scans }),
    getScan: new GetScan({ authz: ports.authz, scans: ports.scans }),
    createScan: new CreateScan({
      authz: ports.authz,
      locations: ports.locations,
      scans: ports.scans,
    }),
    updateScan: new UpdateScan({ authz: ports.authz, scans: ports.scans }),
    listNotes: new ListNotes({ authz: ports.authz, notes: ports.notes }),
    getNote: new GetNote({ authz: ports.authz, notes: ports.notes }),
    createNote: new CreateNote({
      authz: ports.authz,
      scans: ports.scans,
      locations: ports.locations,
      notes: ports.notes,
    }),
    listLocations: new ListLocations({
      authz: ports.authz,
      locations: ports.locations,
    }),
    getLocation: new GetLocation({
      authz: ports.authz,
      locations: ports.locations,
    }),
    createLocation: new CreateLocation({
      authz: ports.authz,
      orgs: ports.orgs,
      regions: ports.regions,
      locations: ports.locations,
    }),
    createRegion: new CreateRegion({
      authz: ports.authz,
      orgs: ports.orgs,
      regions: ports.regions,
    }),
    listGroups: new ListGroups({ authz: ports.authz, groups: ports.groups }),
    getGroup: new GetGroup({ authz: ports.authz, groups: ports.groups }),
    createGroup: new CreateGroup({ authz: ports.authz, groups: ports.groups }),
    addMember: new AddMember({ authz: ports.authz, groups: ports.groups }),
    removeMember: new RemoveMember({
      authz: ports.authz,
      groups: ports.groups,
    }),
    grantShare: new GrantShare(records),
    revokeShare: new RevokeShare(records),
    explainAccess: new ExplainAccess({ authz: ports.authz }),
  };
}

export type Api = ReturnType<typeof createApi>;
