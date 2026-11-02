import { randomUUID } from 'node:crypto';
import { type AccessFilter, Grant, PermissionSet } from '@hexok/authz';
import { describeAgreement } from '@hexok/test-authz';
import { type Db, MongoClient, ObjectId } from 'mongodb';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accessStages } from './access-stages.js';
import { MongoPathStore } from './mongo-path-store.js';
import { MongoPolicyStore } from './mongo-policy-store.js';

const url = process.env.MONGO_URL;
if (process.env.CI && !url) {
  throw new Error('MONGO_URL is required when CI is set');
}

const NOW = new Date(0);

describe.skipIf(!url)('Mongo adapters', () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    client = await MongoClient.connect(url as string);
  });

  beforeEach(async () => {
    db = client.db(`authz_test_${randomUUID().slice(0, 8)}`);
  });

  afterAll(async () => {
    for (const { name } of (await client.db().admin().listDatabases())
      .databases) {
      if (name.startsWith('authz_test_')) await client.db(name).dropDatabase();
    }
    await client.close();
  });

  describe('MongoPathStore', () => {
    let store: MongoPathStore;
    const doc = {
      id: 'scan:1',
      orgId: 'org:a',
      path: ['org:a', 'loc:g', 'scan:1'],
      parents: ['loc:g'],
    };

    beforeEach(async () => {
      store = new MongoPathStore({ db });
      await store.start();
    });

    it('round-trips a doc, and put is an upsert', async () => {
      await store.put(doc);
      await store.put(doc);
      await expect(store.get(['scan:1', 'nope'])).resolves.toEqual([doc]);
    });

    it('keeps an ObjectId resourceId, and update leaves it alone', async () => {
      const resourceId = new ObjectId();
      await store.put({ ...doc, resourceId });
      await store.update([{ id: 'scan:1', path: ['x'], parents: ['y'] }]);
      await expect(store.get(['scan:1'])).resolves.toEqual([
        { ...doc, path: ['x'], parents: ['y'], resourceId },
      ]);
    });

    it('update ignores ids it does not hold, and an empty list', async () => {
      await store.update([]);
      await store.update([{ id: 'nope', path: ['x'], parents: [] }]);
      await expect(store.get(['nope'])).resolves.toEqual([]);
    });

    it('refuses two records with one resourceId, and allows many without', async () => {
      await store.put({ ...doc, resourceId: 'same' });
      await expect(
        store.put({ ...doc, id: 'scan:2', resourceId: 'same' }),
      ).rejects.toMatchObject({ code: 11000 });
      await store.put({ ...doc, id: 'scan:3' });
      await store.put({ ...doc, id: 'scan:4' });
    });

    it('descendants and remove follow the path', async () => {
      await store.put({ ...doc, path: ['org:a', 'loc:g'], id: 'loc:g' });
      await store.put(doc);
      await store.put({ ...doc, id: 'org:a', path: ['org:a'], parents: [] });
      const below = await store.descendants('loc:g');
      expect(below.map((row) => row.id).sort()).toEqual(['loc:g', 'scan:1']);
      await store.remove('loc:g');
      await expect(store.get(['loc:g', 'scan:1'])).resolves.toEqual([]);
      await expect(store.get(['org:a'])).resolves.toHaveLength(1);
    });
  });

  describe('MongoPolicyStore', () => {
    let store: MongoPolicyStore;
    const setProps = {
      id: 'set:v',
      orgId: 'org:a',
      name: 'Viewer',
      actions: ['a:b'],
      allActions: false,
      createdBy: 'u',
      createdAt: NOW,
      updatedAt: NOW,
    };
    const grantProps = {
      id: 'grant:1',
      orgId: 'org:a',
      subject: 'group:g',
      setId: 'set:v',
      folders: ['loc:g'],
      effect: 'allow' as const,
      createdBy: 'u',
      createdAt: NOW,
    };

    beforeEach(async () => {
      store = new MongoPolicyStore({ db });
      await store.start();
    });

    it('saves and restores a set, and commits it', async () => {
      const set = PermissionSet.create(setProps);
      await store.saveSet(set);
      expect(set.isNew).toBe(false);
      const loaded = await store.getSet('set:v');
      expect(loaded?.props).toEqual(setProps);
      loaded?.change({ name: 'Renamed' }, new Date(1));
      if (loaded) await store.saveSet(loaded);
      expect((await store.getSet('set:v'))?.props.name).toBe('Renamed');
      await store.deleteSet('set:v');
      await expect(store.getSet('set:v')).resolves.toBeNull();
    });

    it('saves, restores, and lists grants', async () => {
      const grant = Grant.create(grantProps);
      await store.saveGrant(grant);
      expect(grant.isNew).toBe(false);
      expect((await store.getGrant('grant:1'))?.props).toEqual(grantProps);
      await expect(store.setInUse('set:v')).resolves.toBe(true);
      await expect(store.setInUse('set:other')).resolves.toBe(false);
      const ids = async (query: Parameters<typeof store.listGrants>[0]) =>
        (await store.listGrants(query)).map((row) => row.props.id);
      await expect(ids({ orgId: 'org:a' })).resolves.toEqual(['grant:1']);
      await expect(ids({ orgId: 'org:b' })).resolves.toEqual([]);
      await expect(
        ids({ orgId: 'org:a', subject: 'group:g', folder: 'loc:g' }),
      ).resolves.toEqual(['grant:1']);
      await expect(ids({ orgId: 'org:a', folder: 'x' })).resolves.toEqual([]);
      await expect(ids({ orgId: 'org:a', subject: 'x' })).resolves.toEqual([]);
      await store.deleteGrant('grant:1');
      await expect(store.getGrant('grant:1')).resolves.toBeNull();
    });

    it('grantsFor joins each grant with its set, by principal and organization', async () => {
      await store.saveSet(PermissionSet.create(setProps));
      await store.saveSet(
        PermissionSet.create({
          ...setProps,
          id: 'set:o',
          actions: [],
          allActions: true,
        }),
      );
      await store.saveGrant(Grant.create(grantProps));
      await store.saveGrant(
        Grant.create({
          ...grantProps,
          id: 'grant:2',
          subject: 'user:s',
          setId: 'set:o',
          effect: 'deny',
        }),
      );
      await store.saveGrant(
        Grant.create({ ...grantProps, id: 'grant:3', orgId: 'org:b' }),
      );
      await store.saveGrant(
        Grant.create({ ...grantProps, id: 'grant:4', subject: 'user:else' }),
      );
      await store.saveGrant(
        Grant.create({ ...grantProps, id: 'grant:5', setId: 'set:gone' }),
      );
      const rows = await store.grantsFor('org:a', ['group:g', 'user:s']);
      expect(rows.filter((row) => row.id !== 'grant:5')).toHaveLength(2);
      expect(rows).toEqual(
        expect.arrayContaining([
          {
            id: 'grant:1',
            effect: 'allow',
            folders: ['loc:g'],
            actions: ['a:b'],
            allActions: false,
          },
          {
            id: 'grant:2',
            effect: 'deny',
            folders: ['loc:g'],
            actions: [],
            allActions: true,
          },
        ]),
      );
      expect(rows.map((row) => row.id)).not.toContain('grant:5');
    });
  });

  describe('accessStages', () => {
    it('leaves no _authz field, and runs for every filter shape', async () => {
      const paths = new MongoPathStore({ db });
      await paths.start();
      const records = db.collection<{ _id: ObjectId; name: string }>('records');
      const _id = new ObjectId();
      await records.insertOne({ _id, name: 'kept' });
      await paths.put({
        id: 'r:1',
        orgId: 'org:a',
        path: ['org:a', 'r:1'],
        parents: ['org:a'],
        resourceId: _id,
      });
      const run = (filter: AccessFilter) =>
        records.aggregate(accessStages(filter)).toArray();
      const base = { orgIds: ['org:a'], deny: [] };
      await expect(run({ ...base, allow: [['org:a']] })).resolves.toEqual([
        { _id, name: 'kept' },
      ]);
      await expect(run({ ...base, allow: [] })).resolves.toEqual([]);
      await expect(
        run({ ...base, allow: [['org:a']], within: [] }),
      ).resolves.toEqual([]);
      await expect(
        run({ ...base, allow: [['org:a']], deny: [['r:1']] }),
      ).resolves.toEqual([]);
    });
  });
});

describeAgreement(
  'Mongo',
  async () => {
    const client = await MongoClient.connect(url as string);
    const central = client.db(`authz_test_${randomUUID().slice(0, 8)}`);
    const resources = client.db(`authz_test_${randomUUID().slice(0, 8)}`);
    const centralPaths = new MongoPathStore({ db: central });
    const copy = new MongoPathStore({ db: resources });
    const policies = new MongoPolicyStore({ db: central });
    await centralPaths.start();
    await copy.start();
    await policies.start();
    const records = resources.collection<{ _id: unknown; recordId: string }>(
      'records',
    );
    return {
      policies,
      central: centralPaths,
      copy,
      resourceId: (id) => (id.startsWith('scan:') ? new ObjectId() : id),
      async addRecord(id, resourceId) {
        await records.insertOne({ _id: resourceId, recordId: id });
      },
      async query(filter) {
        const rows = await records.aggregate(accessStages(filter)).toArray();
        return rows.map((row) => row.recordId as string);
      },
      async cleanup() {
        await central.dropDatabase();
        await resources.dropDatabase();
        await client.close();
      },
    };
  },
  { skip: !url },
);
