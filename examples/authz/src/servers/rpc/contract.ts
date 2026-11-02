import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { explanationSchema, tupleSchema } from '../../app/authz/wire.js';
import { explainAccessInput } from '../../app/use-cases/access/api/query/explain-access.js';
import { addMemberInput } from '../../app/use-cases/groups/api/command/add-member.js';
import { createGroupInput } from '../../app/use-cases/groups/api/command/create-group.js';
import { removeMemberInput } from '../../app/use-cases/groups/api/command/remove-member.js';
import { getGroupInput } from '../../app/use-cases/groups/api/query/get-group.js';
import { listGroupsInput } from '../../app/use-cases/groups/api/query/list-groups.js';
import { createLocationInput } from '../../app/use-cases/locations/api/command/create-location.js';
import { getLocationInput } from '../../app/use-cases/locations/api/query/get-location.js';
import { listLocationsInput } from '../../app/use-cases/locations/api/query/list-locations.js';
import { createNoteInput } from '../../app/use-cases/notes/api/command/create-note.js';
import { getNoteInput } from '../../app/use-cases/notes/api/query/get-note.js';
import { listNotesInput } from '../../app/use-cases/notes/api/query/list-notes.js';
import { createRegionInput } from '../../app/use-cases/regions/api/command/create-region.js';
import { createScanInput } from '../../app/use-cases/scans/api/command/create-scan.js';
import { updateScanInput } from '../../app/use-cases/scans/api/command/update-scan.js';
import { getScanInput } from '../../app/use-cases/scans/api/query/get-scan.js';
import { listScansInput } from '../../app/use-cases/scans/api/query/list-scans.js';
import { shareInput } from '../../app/use-cases/shares/share-input.js';
import { groupSchema } from '../../domain/schemas/group.js';
import { locationSchema } from '../../domain/schemas/location.js';
import { noteSchema } from '../../domain/schemas/note.js';
import { regionSchema } from '../../domain/schemas/region.js';
import { scanSchema } from '../../domain/schemas/scan.js';
import { declared } from './errors.js';

/**
 * The API. HTTP serves it at `/rpc`, such as `POST /rpc/scans/list`.
 * Inputs are the use case schemas. Errors are the domain errors each
 * procedure can throw.
 */
export const apiContract = router({
  scans: {
    list: procedure
      .input(listScansInput)
      .output(z.array(scanSchema))
      .errors({}),
    get: procedure
      .input(getScanInput)
      .output(scanSchema)
      .errors(declared('Forbidden', 'NotFound')),
    create: procedure
      .input(createScanInput)
      .output(scanSchema)
      .errors(declared('Forbidden', 'NotFound', 'AlreadyExists')),
    update: procedure
      .input(updateScanInput)
      .output(scanSchema)
      .errors(declared('Forbidden', 'NotFound')),
  },
  notes: {
    list: procedure
      .input(listNotesInput)
      .output(z.array(noteSchema))
      .errors({}),
    get: procedure
      .input(getNoteInput)
      .output(noteSchema)
      .errors(declared('Forbidden', 'NotFound')),
    create: procedure
      .input(createNoteInput)
      .output(noteSchema)
      .errors(declared('Forbidden', 'NotFound', 'AlreadyExists')),
  },
  locations: {
    list: procedure
      .input(listLocationsInput)
      .output(z.array(locationSchema))
      .errors({}),
    get: procedure
      .input(getLocationInput)
      .output(locationSchema)
      .errors(declared('Forbidden', 'NotFound')),
    create: procedure
      .input(createLocationInput)
      .output(locationSchema)
      .errors(declared('Forbidden', 'NotFound', 'AlreadyExists')),
  },
  regions: {
    create: procedure
      .input(createRegionInput)
      .output(regionSchema)
      .errors(declared('Forbidden', 'NotFound', 'AlreadyExists')),
  },
  groups: {
    list: procedure
      .input(listGroupsInput)
      .output(z.array(groupSchema))
      .errors({}),
    get: procedure
      .input(getGroupInput)
      .output(groupSchema)
      .errors(declared('Forbidden', 'NotFound')),
    create: procedure
      .input(createGroupInput)
      .output(groupSchema)
      .errors(declared('AlreadyExists')),
    addMember: procedure
      .input(addMemberInput)
      .output(tupleSchema)
      .errors(declared('Forbidden', 'NotFound', 'MemberInvalid')),
    removeMember: procedure
      .input(removeMemberInput)
      .output(tupleSchema)
      .errors(declared('Forbidden', 'NotFound', 'MemberInvalid')),
  },
  shares: {
    grant: procedure
      .input(shareInput)
      .output(tupleSchema)
      .errors(
        declared(
          'Forbidden',
          'NotFound',
          'ShareRelationInvalid',
          'SubjectInvalid',
        ),
      ),
    revoke: procedure
      .input(shareInput)
      .output(tupleSchema)
      .errors(
        declared(
          'Forbidden',
          'NotFound',
          'ShareRelationInvalid',
          'SubjectInvalid',
        ),
      ),
  },
  access: {
    explain: procedure
      .input(explainAccessInput)
      .output(explanationSchema)
      .errors({}),
  },
});
