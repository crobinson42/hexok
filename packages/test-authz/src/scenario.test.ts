import {
  Authz,
  CreatePermissionSet,
  GetAccessSummary,
  GrantAccess,
  MemoryPathStore,
  MemoryPolicyStore,
  memoryFilter,
  Paths,
  type RequestAuthz,
  RevokeGrant,
  UpdatePermissionSet,
} from '@hexok/authz';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type ScenarioAction,
  ScenarioCatalog,
  ScenarioPrincipals,
  type ScenarioSeed,
  seedScenario,
} from './scenario.js';

/** The rows run in order against one world, as the table reads. */
describe('reference scenario, in memory', () => {
  const policies = new MemoryPolicyStore();
  const central = new MemoryPathStore();
  const places = new MemoryPathStore();
  const scans = new MemoryPathStore();
  const paths = new Paths({ central, copies: { places, scans } });
  const authz = new Authz(
    { policies, paths: central, principals: new ScenarioPrincipals() },
    { catalog: ScenarioCatalog },
  );
  const admin = { policies, catalog: ScenarioCatalog };
  let seed: ScenarioSeed;
  let leeGrant: string;

  const as = async (
    subject: string,
    orgId = 'org:acme',
  ): Promise<RequestAuthz<ScenarioAction>> =>
    authz.forActor(await authz.actor(subject, orgId));
  const listScans = async (view: RequestAuthz<ScenarioAction>) =>
    memoryFilter(scans.all(), await view.filter('scan:read'))
      .filter((doc) => doc.id.startsWith('scan:'))
      .map((doc) => doc.id);
  const listNotes = async (
    view: RequestAuthz<ScenarioAction>,
    parent: string,
  ) =>
    memoryFilter(scans.all(), await view.filter('note:read'))
      .filter((doc) => doc.parents.includes(parent))
      .map((doc) => doc.id);
  const grantToLee = async (setId: string, folder: string) =>
    new GrantAccess(admin).execute(
      { authz: await as('user:sam') },
      { subject: 'user:lee', setId, folders: [folder] },
    );

  beforeAll(async () => {
    seed = await seedScenario({ policies, paths, authz });
    await paths.place({ id: 'scan:a1', parent: 'loc:gate-a' }, 'scans');
    await paths.place({ id: 'scan:b1', parent: 'loc:gate-b' }, 'scans');
    await paths.place({ id: 'scan:d1', parent: 'loc:dock-1' }, 'scans');
  });

  it('1: Sam lists scans in region west only', async () => {
    await expect(listScans(await as('user:sam'))).resolves.toEqual([
      'scan:a1',
      'scan:b1',
    ]);
  });

  it('2: Sam creates a note on QR-A1, then edits it', async () => {
    const sam = await as('user:sam');
    await sam.require('note:create', 'scan:a1');
    await paths.place({ id: 'note:1', parent: 'scan:a1' }, 'scans');
    await expect(
      (await as('user:sam')).require('note:edit', 'note:1'),
    ).resolves.toBeUndefined();
  });

  it('3: Sam cannot delete the note: deny wins', async () => {
    await expect(
      (await as('user:sam')).require('note:delete', 'note:1'),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'note:delete' },
    });
  });

  it('4: Sam cannot create a note on QR-D1', async () => {
    await expect(
      (await as('user:sam')).require('note:create', 'scan:d1'),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'note:create' },
    });
  });

  it('6: Sam lists the note on QR-A1', async () => {
    await expect(listNotes(await as('user:sam'), 'scan:a1')).resolves.toEqual([
      'note:1',
    ]);
  });

  it('7: Sam grants Viewer on gate-a to Lee', async () => {
    const grant = await grantToLee(seed.sets.viewer, 'loc:gate-a');
    leeGrant = grant.id;
    await expect(
      (await as('user:lee')).can('scan:read', 'scan:a1'),
    ).resolves.toBe(true);
  });

  it('8: Sam cannot grant Note Editor: escalation', async () => {
    await expect(
      grantToLee(seed.sets.noteEditor, 'loc:gate-a'),
    ).rejects.toMatchObject({
      code: 'Escalation',
      data: { missing: ['note:delete'] },
    });
  });

  it('9: Sam cannot grant on region west', async () => {
    await expect(
      grantToLee(seed.sets.viewer, 'region:west'),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'access:manage' },
    });
  });

  it('10: Sam in Globex sees no scans', async () => {
    await expect(
      listScans(await as('user:sam', 'org:globex')),
    ).resolves.toEqual([]);
  });

  it('11: Sam must name an organization', async () => {
    await expect(authz.actor('user:sam')).rejects.toMatchObject({
      code: 'OrgRequired',
    });
  });

  it('16: Sam cannot revoke the deny that binds Sam', async () => {
    await expect(
      new RevokeGrant({ policies }).execute(
        { authz: await as('user:sam') },
        { id: seed.grants.crewNoDelete },
      ),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'access:manage' },
    });
    await expect(
      (await as('user:sam')).can('note:delete', 'note:1'),
    ).resolves.toBe(false);
  });

  it('17: a root admin with only access:manage cannot add an action to a set', async () => {
    const cory = { authz: await as('user:cory') };
    const onlyManage = await new CreatePermissionSet(admin).execute(cory, {
      name: 'Only Manage',
      actions: ['access:manage'],
    });
    await new GrantAccess(admin).execute(cory, {
      subject: 'user:mid',
      setId: onlyManage.id,
      folders: ['org:acme'],
    });
    await expect(
      new UpdatePermissionSet(admin).execute(
        { authz: await as('user:mid') },
        { id: seed.sets.viewer, actions: ['scan:read', 'note:delete'] },
      ),
    ).rejects.toMatchObject({
      code: 'Escalation',
      data: { missing: ['note:delete'] },
    });
  });

  it('12: after Cory moves gate-a east, Sam lists only QR-B1', async () => {
    await (await as('user:cory')).require('location:manage', 'loc:gate-a');
    await paths.move({ id: 'loc:gate-a', parent: 'region:east' });
    await expect(listScans(await as('user:sam'))).resolves.toEqual(['scan:b1']);
  });

  it('13: after the move, Sam still lists the note', async () => {
    await expect(listNotes(await as('user:sam'), 'scan:a1')).resolves.toEqual([
      'note:1',
    ]);
  });

  it('14: Cory revokes Viewer, and Sam lists no scans at once', async () => {
    await new RevokeGrant({ policies }).execute(
      { authz: await as('user:cory') },
      { id: seed.grants.crewViewer },
    );
    await expect(listScans(await as('user:sam'))).resolves.toEqual([]);
    expect(leeGrant).toBeDefined();
  });

  it('15: the summary shows what is left and where', async () => {
    const summary = await new GetAccessSummary().execute({
      authz: await as('user:sam'),
    });
    expect(summary.actor).toEqual({ id: 'user:sam', orgId: 'org:acme' });
    const gate = { allow: [['loc:gate-a']], deny: [] };
    expect(summary.actions).toEqual({
      'note:read': { allow: [['loc:gate-a'], ['loc:gate-a']], deny: [] },
      'note:create': gate,
      'note:edit': gate,
      'note:delete': { allow: [['loc:gate-a']], deny: [['loc:gate-a']] },
      'access:manage': gate,
    });
  });
});
