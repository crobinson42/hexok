import type { Actor, Authz, Tuple } from '@hexok/authz';
import { DomainError } from '../../../domain/errors/domain.js';
import type { catalog } from '../../authz/catalog.js';
import type { GroupRepository } from '../../ports/repos/group-repository.js';
import type { LocationRepository } from '../../ports/repos/location-repository.js';
import type { NoteRepository } from '../../ports/repos/note-repository.js';
import type { OrgRepository } from '../../ports/repos/org-repository.js';
import type { RegionRepository } from '../../ports/repos/region-repository.js';
import type { ScanRepository } from '../../ports/repos/scan-repository.js';
import type { ShareInput } from './share-input.js';

export type ShareDeps = {
  authz: Authz<typeof catalog>;
  orgs: OrgRepository;
  regions: RegionRepository;
  locations: LocationRepository;
  scans: ScanRepository;
  notes: NoteRepository;
  groups: GroupRepository;
};

/**
 * A share is a `viewer` or `editor` tuple.
 * The actor must pass the edit check. The record must exist after that check.
 */
export async function shareTuple(
  deps: ShareDeps,
  actor: Actor,
  input: ShareInput,
): Promise<Tuple> {
  if (input.relation !== 'viewer' && input.relation !== 'editor') {
    throw DomainError.ShareRelationInvalid();
  }
  await requireEdit(deps, actor, input);
  await shareSubject(deps.groups, input.subject);
  return {
    object: `${input.type}:${input.id}`,
    relation: input.relation,
    subject: input.subject,
  };
}

async function requireEdit(
  deps: ShareDeps,
  actor: Actor,
  input: ShareInput,
): Promise<void> {
  const allowed = await canEdit(deps.authz, actor, input);
  if (!allowed) throw DomainError.Forbidden();
  if (!(await stored(deps, input))) {
    throw DomainError.NotFound({ type: input.type, id: input.id });
  }
}

async function canEdit(
  authz: Authz<typeof catalog>,
  actor: Actor,
  input: ShareInput,
): Promise<boolean> {
  switch (input.type) {
    case 'org':
      return authz.check({
        actor,
        action: 'org:edit',
        resource: { type: 'org', id: input.id },
      });
    case 'region':
      return authz.check({
        actor,
        action: 'region:edit',
        resource: { type: 'region', id: input.id },
      });
    case 'location':
      return authz.check({
        actor,
        action: 'location:edit',
        resource: { type: 'location', id: input.id },
      });
    case 'scan':
      return authz.check({
        actor,
        action: 'scan:edit',
        resource: { type: 'scan', id: input.id },
      });
    case 'note':
      return authz.check({
        actor,
        action: 'note:edit',
        resource: { type: 'note', id: input.id },
      });
    case 'group':
      return authz.check({
        actor,
        action: 'group:edit',
        resource: { type: 'group', id: input.id },
      });
    default:
      return unreachable(input.type);
  }
}

async function stored(deps: ShareDeps, input: ShareInput): Promise<boolean> {
  switch (input.type) {
    case 'org':
      return (await deps.orgs.get(input.id)) !== null;
    case 'region':
      return (await deps.regions.get(input.id)) !== null;
    case 'location':
      return (await deps.locations.get(input.id)) !== null;
    case 'scan':
      return (await deps.scans.get(input.id)) !== null;
    case 'note':
      return (await deps.notes.get(input.id)) !== null;
    case 'group':
      return (await deps.groups.get(input.id)) !== null;
    default:
      return unreachable(input.type);
  }
}

async function shareSubject(
  groups: GroupRepository,
  subject: string,
): Promise<void> {
  const hash = subject.indexOf('#');
  const object = hash === -1 ? subject : subject.slice(0, hash);
  if (hash !== -1 && subject.slice(hash + 1).length === 0) {
    throw DomainError.SubjectInvalid();
  }
  if (object.startsWith('user:')) {
    if (object.length === 'user:'.length) throw DomainError.SubjectInvalid();
    return;
  }
  if (object.startsWith('group:')) {
    const id = object.slice('group:'.length);
    if (id.length === 0) throw DomainError.SubjectInvalid();
    if ((await groups.get(id)) === null) {
      throw DomainError.NotFound({ type: 'group', id });
    }
  }
}

function unreachable(value: never): never {
  throw new Error(`Unsupported value ${String(value)}.`);
}
