import {
  type AccessAction,
  AccessCatalog,
  type Authz,
  BootstrapOrganization,
  CreatePermissionSet,
  GrantAccess,
  type Membership,
  type PathStore,
  type Paths,
  type PolicyStore,
  Principals,
} from '@hexok/authz';
import { Adapter } from 'hexok';

/** The reference product's actions. */
export class ScenarioCatalog extends AccessCatalog('scenario', {
  actions: [
    'location:read',
    'location:manage',
    'scan:read',
    'scan:create',
    'note:read',
    'note:create',
    'note:edit',
    'note:delete',
  ],
}) {}

export type ScenarioAction = AccessAction<typeof ScenarioCatalog>;

const MEMBERSHIPS: Readonly<Record<string, readonly Membership[]>> = {
  'user:cory': [{ orgId: 'org:acme', groups: ['group:admins'] }],
  'user:sam': [
    { orgId: 'org:acme', groups: ['group:night-crew'] },
    { orgId: 'org:globex', groups: [] },
  ],
  'user:lee': [{ orgId: 'org:acme', groups: [] }],
  'user:mid': [{ orgId: 'org:acme', groups: [] }],
};

/** The memberships of the reference scenario. */
export class ScenarioPrincipals extends Adapter(Principals) {
  override async memberships(
    subject: string,
    orgId?: string,
  ): Promise<readonly Membership[]> {
    const rows = MEMBERSHIPS[subject] ?? [];
    return orgId === undefined
      ? rows
      : rows.filter((row) => row.orgId === orgId);
  }
}

export type ScenarioPaths = Paths<{ places: PathStore; scans: PathStore }>;

export type ScenarioSeed = {
  readonly sets: {
    readonly viewer: string;
    readonly noteEditor: string;
    readonly noDelete: string;
    readonly siteAdmin: string;
  };
  readonly grants: {
    readonly crewViewer: string;
    readonly crewNoDelete: string;
  };
};

/**
 * Seeds organizations, folders, sets, and grants through the ports, as
 * section 12 of the plan describes. Scans are left to the caller, so a real
 * product can record them through its own use cases.
 */
export async function seedScenario(deps: {
  readonly policies: PolicyStore;
  readonly paths: ScenarioPaths;
  readonly authz: Authz<ScenarioAction>;
}): Promise<ScenarioSeed> {
  const { policies, paths, authz } = deps;
  const bootstrap = new BootstrapOrganization({ policies, paths });
  await bootstrap.execute({ orgId: 'org:acme', founder: 'group:admins' });
  await bootstrap.execute({ orgId: 'org:globex', founder: 'group:globex' });

  await paths.place({ id: 'region:west', parent: 'org:acme' }, 'places');
  await paths.place({ id: 'region:east', parent: 'org:acme' }, 'places');
  await paths.place({ id: 'loc:gate-a', parent: 'region:west' }, 'places');
  await paths.place({ id: 'loc:gate-b', parent: 'region:west' }, 'places');
  await paths.place({ id: 'loc:dock-1', parent: 'region:east' }, 'places');

  const cory = { authz: authz.forActor(await authz.actor('user:cory')) };
  const admin = { policies, catalog: ScenarioCatalog };
  const create = new CreatePermissionSet(admin);
  const makeSet = async (name: string, actions: readonly ScenarioAction[]) =>
    (await create.execute(cory, { name, actions })).id;

  const viewer = await makeSet('Viewer', [
    'location:read',
    'scan:read',
    'note:read',
  ]);
  const noteEditor = await makeSet('Note Editor', [
    'note:read',
    'note:create',
    'note:edit',
    'note:delete',
  ]);
  const noDelete = await makeSet('No Delete', ['note:delete']);
  const siteAdmin = await makeSet('Site Admin', ['access:manage', 'note:read']);

  const grantAccess = new GrantAccess(admin);
  const crewViewer = await grantAccess.execute(cory, {
    subject: 'group:night-crew',
    setId: viewer,
    folders: ['region:west'],
  });
  await grantAccess.execute(cory, {
    subject: 'group:night-crew',
    setId: noteEditor,
    folders: ['loc:gate-a'],
  });
  const crewNoDelete = await grantAccess.execute(cory, {
    subject: 'group:night-crew',
    setId: noDelete,
    folders: ['loc:gate-a'],
    effect: 'deny',
  });
  await grantAccess.execute(cory, {
    subject: 'user:sam',
    setId: siteAdmin,
    folders: ['loc:gate-a'],
  });

  return {
    sets: { viewer, noteEditor, noDelete, siteAdmin },
    grants: { crewViewer: crewViewer.id, crewNoDelete: crewNoDelete.id },
  };
}
