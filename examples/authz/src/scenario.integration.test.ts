import { randomUUID } from 'node:crypto';
import {
  AuthzError,
  CreatePermissionSet,
  GetAccessSummary,
  GrantAccess,
  RevokeGrant,
  UpdatePermissionSet,
} from '@hexok/authz';
import {
  ScenarioCatalog,
  ScenarioPrincipals,
  type ScenarioSeed,
  seedScenario,
} from '@hexok/test-authz';
import { type Db, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compose } from './composition.js';
import { ExampleError, Location } from './domain.js';
import {
  CreateNote,
  DeleteNote,
  EditNote,
  ListNotes,
  ListScans,
  MoveLocation,
  RecordScan,
} from './use-cases.js';

const url = process.env.MONGO_URL;
if (process.env.CI && !url) {
  throw new Error('MONGO_URL is required when CI is set');
}

/** The rows run in order against one world, as the table reads. */
describe.skipIf(!url)('reference scenario on three databases', () => {
  let authzClient: MongoClient;
  let resourceClient: MongoClient;
  let databases: { authz: Db; places: Db; scans: Db };
  let app: Awaited<ReturnType<typeof compose>>;
  let seed: ScenarioSeed;
  let note: { id: string };
  let scanA: string;
  let scanD: string;

  const as = async (subject: string, orgId = 'org:acme') => ({
    authz: app.authz.forActor(await app.authz.actor(subject, orgId)),
  });
  const admin = () => ({
    policies: app.policies,
    catalog: ScenarioCatalog,
  });
  const scanCodes = async (subject: string, orgId?: string) => {
    const scans = await new ListScans({ scans: app.scans }).execute(
      await as(subject, orgId),
    );
    return scans.map((scan) => scan.code);
  };
  const samNotes = async () =>
    new ListNotes({ notes: app.notes }).execute(await as('user:sam'), {
      parentId: scanA,
    });
  const grantToLee = async (setId: string, folder: string) =>
    new GrantAccess(admin()).execute(await as('user:sam'), {
      subject: 'user:lee',
      setId,
      folders: [folder],
    });

  beforeAll(async () => {
    authzClient = await MongoClient.connect(url as string);
    resourceClient = await MongoClient.connect(url as string);
    const suffix = randomUUID().slice(0, 8);
    databases = {
      authz: authzClient.db(`example_authz_${suffix}`),
      places: resourceClient.db(`example_places_${suffix}`),
      scans: resourceClient.db(`example_scans_${suffix}`),
    };
    app = await compose(databases, new ScenarioPrincipals());
    seed = await seedScenario({
      policies: app.policies,
      paths: app.paths,
      authz: app.authz,
    });
    for (const [id, regionId] of [
      ['loc:gate-a', 'region:west'],
      ['loc:gate-b', 'region:west'],
      ['loc:dock-1', 'region:east'],
    ] as const) {
      await app.locations.save(Location.create({ id, regionId }));
    }
    const record = new RecordScan({ scans: app.scans, events: app.events });
    const cory = await as('user:cory');
    const a = await record.execute(cory, {
      code: 'QR-A1',
      locationId: 'loc:gate-a',
    });
    await record.execute(cory, { code: 'QR-B1', locationId: 'loc:gate-b' });
    const d = await record.execute(cory, {
      code: 'QR-D1',
      locationId: 'loc:dock-1',
    });
    scanA = a.id;
    scanD = d.id;
  }, 60_000);

  afterAll(async () => {
    await Promise.all(Object.values(databases).map((db) => db.dropDatabase()));
    await authzClient.close();
    await resourceClient.close();
  });

  it('keeps grants central, and paths next to their records', async () => {
    const names = async (db: Db) =>
      (await db.listCollections().toArray()).map((row) => row.name).sort();
    await expect(names(databases.authz)).resolves.toEqual([
      'authz_grants',
      'authz_paths',
      'authz_sets',
    ]);
    await expect(names(databases.places)).resolves.toEqual([
      'authz_paths',
      'locations',
    ]);
    await expect(names(databases.scans)).resolves.toEqual([
      'authz_paths',
      'notes',
      'scans',
    ]);
    const scan = await databases.scans.collection('scans').findOne({});
    expect(Object.keys(scan ?? {}).sort()).toEqual([
      '_id',
      'code',
      'locationId',
    ]);
  });

  it('1: Sam lists scans in region west only', async () => {
    await expect(scanCodes('user:sam')).resolves.toEqual(['QR-A1', 'QR-B1']);
  });

  it('2: Sam creates a note on QR-A1, then edits it', async () => {
    note = await new CreateNote({
      notes: app.notes,
      events: app.events,
    }).execute(await as('user:sam'), { parentId: scanA, body: 'first' });
    await expect(
      new EditNote({ notes: app.notes }).execute(await as('user:sam'), {
        id: note.id,
        body: 'second',
      }),
    ).resolves.toMatchObject({ body: 'second' });
  });

  it('3: Sam cannot delete the note: deny wins', async () => {
    await expect(
      new DeleteNote({ notes: app.notes, events: app.events }).execute(
        await as('user:sam'),
        { id: note.id },
      ),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'note:delete' },
    });
  });

  it('4: Sam cannot create a note on QR-D1', async () => {
    await expect(
      new CreateNote({ notes: app.notes, events: app.events }).execute(
        await as('user:sam'),
        { parentId: scanD, body: 'nope' },
      ),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'note:create' },
    });
  });

  it("5: a blank body is the entity's own error, not an authz error", async () => {
    const edit = new EditNote({ notes: app.notes }).execute(
      await as('user:sam'),
      { id: note.id, body: '  ' },
    );
    const error = await edit.catch((caught: unknown) => caught);
    expect(ExampleError.is(error)).toBe(true);
    expect(AuthzError.is(error)).toBe(false);
    expect(error).toMatchObject({ code: 'BlankBody' });
  });

  it('6: Sam lists the note on QR-A1', async () => {
    await expect(samNotes()).resolves.toMatchObject([
      { id: note.id, body: 'second' },
    ]);
  });

  it('7: Sam grants Viewer on gate-a to Lee', async () => {
    await expect(
      grantToLee(seed.sets.viewer, 'loc:gate-a'),
    ).resolves.toMatchObject({ subject: 'user:lee' });
    await expect(scanCodes('user:lee')).resolves.toEqual(['QR-A1']);
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
    await expect(scanCodes('user:sam', 'org:globex')).resolves.toEqual([]);
  });

  it('11: Sam must name an organization', async () => {
    await expect(app.authz.actor('user:sam')).rejects.toMatchObject({
      code: 'OrgRequired',
    });
  });

  it('16: Sam cannot revoke the deny that binds Sam', async () => {
    await expect(
      new RevokeGrant({ policies: app.policies }).execute(
        await as('user:sam'),
        { id: seed.grants.crewNoDelete },
      ),
    ).rejects.toMatchObject({
      code: 'Forbidden',
      data: { action: 'access:manage' },
    });
  });

  it('17: a root admin with only access:manage cannot add an action to a set', async () => {
    const cory = await as('user:cory');
    const onlyManage = await new CreatePermissionSet(admin()).execute(cory, {
      name: 'Only Manage',
      actions: ['access:manage'],
    });
    await new GrantAccess(admin()).execute(cory, {
      subject: 'user:mid',
      setId: onlyManage.id,
      folders: ['org:acme'],
    });
    await expect(
      new UpdatePermissionSet(admin()).execute(await as('user:mid'), {
        id: seed.sets.viewer,
        actions: ['scan:read', 'note:delete'],
      }),
    ).rejects.toMatchObject({
      code: 'Escalation',
      data: { missing: ['note:delete'] },
    });
  });

  it('12: after Cory moves gate-a east, Sam lists only QR-B1, and no scan changed', async () => {
    const scans = databases.scans.collection('scans');
    const before = await scans.find({}).sort({ code: 1 }).toArray();
    await new MoveLocation({
      locations: app.locations,
      events: app.events,
    }).execute(await as('user:cory'), {
      id: 'loc:gate-a',
      regionId: 'region:east',
    });
    await expect(scanCodes('user:sam')).resolves.toEqual(['QR-B1']);
    await expect(scans.find({}).sort({ code: 1 }).toArray()).resolves.toEqual(
      before,
    );
  });

  it('13: after the move, Sam still lists the note', async () => {
    await expect(samNotes()).resolves.toMatchObject([{ id: note.id }]);
  });

  it('14: Cory revokes Viewer, and Sam lists no scans at once', async () => {
    await new RevokeGrant({ policies: app.policies }).execute(
      await as('user:cory'),
      { id: seed.grants.crewViewer },
    );
    await expect(scanCodes('user:sam')).resolves.toEqual([]);
  });

  it('15: the summary shows what is left and where', async () => {
    const summary = await new GetAccessSummary().execute(await as('user:sam'));
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
