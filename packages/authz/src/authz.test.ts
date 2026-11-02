import { Adapter } from 'hexok';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { Authz, type RequestAuthz } from './authz.js';
import { type AccessAction, AccessCatalog, type MANAGE } from './catalog.js';
import { Grant, PermissionSet } from './entities.js';
import { MemoryPathStore, MemoryPolicyStore, memoryFilter } from './memory.js';
import { type Actor, matches } from './model.js';
import { type Membership, Principals } from './ports.js';

class Shop extends AccessCatalog('shop', {
  actions: ['order:read', 'order:edit', 'order:delete'],
}) {}
type Action = AccessAction<typeof Shop>;

class FixedPrincipals extends Adapter(Principals) {
  constructor(private readonly rows: Record<string, readonly Membership[]>) {
    super();
  }
  override async memberships(subject: string, orgId?: string) {
    const rows = this.rows[subject] ?? [];
    return orgId === undefined
      ? rows
      : rows.filter((row) => row.orgId === orgId);
  }
}

const NOW = new Date(0);

describe('Authz', () => {
  let policies: MemoryPolicyStore;
  let paths: MemoryPathStore;
  let authz: Authz<Action>;

  async function place(id: string, ...ancestors: string[]) {
    await paths.put({
      id,
      orgId: ancestors[0] ?? id,
      path: [...ancestors, id],
      parents: ancestors.slice(-1),
    });
  }

  async function set(
    id: string,
    actions: readonly string[],
    allActions = false,
  ) {
    await policies.saveSet(
      PermissionSet.create({
        id,
        orgId: 'org:a',
        name: id,
        actions,
        allActions,
        createdBy: 'user:root',
        createdAt: NOW,
        updatedAt: NOW,
      }),
    );
  }

  async function grant(
    setId: string,
    subject: string,
    folders: readonly string[],
    effect: 'allow' | 'deny' = 'allow',
  ) {
    await policies.saveGrant(
      Grant.create({
        id: `grant:${setId}:${subject}:${folders.join()}`,
        orgId: 'org:a',
        subject,
        setId,
        folders,
        effect,
        createdBy: 'user:root',
        createdAt: NOW,
      }),
    );
  }

  beforeEach(async () => {
    policies = new MemoryPolicyStore();
    paths = new MemoryPathStore();
    authz = new Authz(
      {
        policies,
        paths,
        principals: new FixedPrincipals({
          'user:sam': [
            { orgId: 'org:a', groups: ['group:crew'] },
            { orgId: 'org:b', groups: [] },
          ],
          'user:lee': [{ orgId: 'org:a', groups: [] }],
        }),
      },
      { catalog: Shop },
    );
    await place('org:a');
    await place('org:b');
    await place('region:w', 'org:a');
    await place('region:e', 'org:a');
    await place('order:1', 'org:a', 'region:w');
    await place('order:2', 'org:a', 'region:e');
    await place('order:9', 'org:b');
  });

  describe('actor', () => {
    it('builds principals from the membership', async () => {
      await expect(authz.actor('user:sam', 'org:a')).resolves.toEqual({
        id: 'user:sam',
        orgId: 'org:a',
        tenants: ['org:a'],
        principals: ['user:sam', 'group:crew'],
      });
    });

    it('picks the only organization when none is named', async () => {
      await expect(authz.actor('user:lee')).resolves.toMatchObject({
        orgId: 'org:a',
      });
    });

    it('throws OrgRequired, then NotAMember', async () => {
      await expect(authz.actor('user:sam')).rejects.toMatchObject({
        code: 'OrgRequired',
      });
      await expect(authz.actor('user:lee', 'org:b')).rejects.toMatchObject({
        code: 'NotAMember',
      });
      await expect(authz.actor('user:ghost')).rejects.toMatchObject({
        code: 'NotAMember',
      });
    });
  });

  describe('forActor', () => {
    async function sam() {
      return authz.forActor(await authz.actor('user:sam', 'org:a'));
    }

    it('allowed, can, and require read the same rule', async () => {
      await set('set:read', ['order:read']);
      await grant('set:read', 'group:crew', ['region:w']);
      const view = await sam();
      await expect(
        view.allowed(['order:1', 'order:2', 'nope']),
      ).resolves.toEqual({
        'order:1': ['order:read'],
        'order:2': [],
        nope: [],
      });
      await expect(view.can('order:read', 'order:1')).resolves.toBe(true);
      await expect(view.can('order:edit', 'order:1')).resolves.toBe(false);
      await expect(view.can('order:read', 'nope')).resolves.toBe(false);
      await expect(
        view.require('order:read', 'order:1'),
      ).resolves.toBeUndefined();
      await expect(view.require('order:edit', 'order:1')).rejects.toMatchObject(
        {
          code: 'Forbidden',
          data: { action: 'order:edit' },
        },
      );
    });

    it('refuses a record in another organization', async () => {
      await set('set:read', ['order:read']);
      await grant('set:read', 'user:sam', ['order:9']);
      const view = await sam();
      await expect(view.can('order:read', 'order:9')).resolves.toBe(false);
    });

    it('filter and allowed agree for every record and action', async () => {
      await set('set:read', ['order:read', 'order:edit']);
      await set('set:no-edit', ['order:edit']);
      await grant('set:read', 'group:crew', ['org:a']);
      await grant('set:no-edit', 'user:sam', ['region:e'], 'deny');
      const view = await sam();
      const docs = paths.all();
      const allowed = await view.allowed(docs.map((doc) => doc.id));
      for (const action of Shop.actions) {
        const filter = await view.filter(action);
        for (const doc of docs) {
          expect(matches(filter, doc)).toBe(
            allowed[doc.id]?.includes(action) ?? false,
          );
        }
      }
      const edit = await view.filter('order:edit');
      expect(memoryFilter(docs, edit).map((doc) => doc.id)).toEqual([
        'org:a',
        'region:w',
        'order:1',
      ]);
    });

    it('filter gives an empty allow when there is no access', async () => {
      const view = await sam();
      await expect(view.filter('order:read')).resolves.toEqual({
        orgIds: ['org:a'],
        allow: [],
        deny: [],
      });
    });

    it('filter returns no allow when a ceiling omits the action', async () => {
      await set('set:read', ['order:read']);
      await grant('set:read', 'user:sam', ['org:a']);
      const actor: Actor = {
        ...(await authz.actor('user:sam', 'org:a')),
        ceiling: [{ actions: ['order:edit'], folders: ['org:a'] }],
      };
      await expect(
        authz.forActor(actor).filter('order:read'),
      ).resolves.toMatchObject({ allow: [], within: [] });
    });

    it('expands allActions to the catalog and ignores removed names', async () => {
      await set('set:owner', [], true);
      await set('set:old', ['order:gone', 'order:read']);
      await grant('set:owner', 'user:lee', ['org:a']);
      await grant('set:old', 'user:sam', ['org:a']);
      const lee = authz.forActor(await authz.actor('user:lee'));
      await expect(lee.allowed(['org:a'])).resolves.toEqual({
        'org:a': Shop.actions,
      });
      const view = await sam();
      await expect(view.allowed(['org:a'])).resolves.toEqual({
        'org:a': ['order:read'],
      });
    });

    it('loads grants once per view', async () => {
      const spy = vi.spyOn(policies, 'grantsFor');
      const view = await sam();
      await view.filter('order:read');
      await view.can('order:read', 'order:1');
      await view.allowed(['order:1']);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('allowedAt evaluates the union of the folders paths', async () => {
      await place('rt:x', 'org:a');
      await set('set:both', ['order:read']);
      await set('set:one', ['order:edit']);
      await grant('set:both', 'user:sam', ['region:w', 'rt:x']);
      await grant('set:one', 'user:sam', ['region:w']);
      const view = await sam();
      await expect(view.allowedAt(['region:w', 'rt:x'])).resolves.toEqual([
        'order:read',
        'order:edit',
      ]);
      await expect(view.allowedAt(['region:w'])).resolves.toEqual([
        'order:edit',
      ]);
    });

    it('allowedAt hides unplaced and other-organization folders alike', async () => {
      const view = await sam();
      await expect(view.allowedAt(['nope'])).rejects.toMatchObject({
        code: 'NotFound',
        data: { id: 'nope' },
      });
      await expect(view.allowedAt(['org:b'])).rejects.toMatchObject({
        code: 'NotFound',
        data: { id: 'org:b' },
      });
    });

    it('summary lists where each held action applies', async () => {
      await set('set:read', ['order:read']);
      await set('set:no-read', ['order:read']);
      await grant('set:read', 'group:crew', ['region:w']);
      await grant('set:no-read', 'user:sam', ['order:1'], 'deny');
      const view = await sam();
      await expect(view.summary()).resolves.toEqual({
        actor: { id: 'user:sam', orgId: 'org:a' },
        actions: {
          'order:read': { allow: [['region:w']], deny: [['order:1']] },
        },
      });
    });
  });

  it('types views from the catalog', async () => {
    const view = authz.forActor(await authz.actor('user:lee'));
    expectTypeOf(view).toEqualTypeOf<RequestAuthz<Action>>();
    // Never called. The compiler reads these lines.
    const unknownActions = () => [
      // @ts-expect-error not in the catalog
      view.can('order:gone', 'order:1'),
      // @ts-expect-error not in the catalog
      view.require('order:gone', 'order:1'),
      // @ts-expect-error not in the catalog
      view.filter('order:gone'),
    ];
    expectTypeOf(unknownActions).toBeFunction();
    expectTypeOf<typeof MANAGE>().toEqualTypeOf<'access:manage'>();
    const general: RequestAuthz = view;
    expect(general.actor.id).toBe('user:lee');
  });
});

describe('entities', () => {
  it('Grant requires at least one folder', () => {
    expect(() =>
      Grant.create({
        id: 'g',
        orgId: 'o',
        subject: 's',
        setId: 't',
        folders: [],
        effect: 'allow',
        createdBy: 'u',
        createdAt: NOW,
      }),
    ).toThrow(/validation failed/);
  });

  it('PermissionSet refuses a blank name, and change keeps the rule', () => {
    const props = {
      id: 'set',
      orgId: 'o',
      name: 'n',
      actions: ['a:b'],
      allActions: false,
      createdBy: 'u',
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() => PermissionSet.create({ ...props, name: ' ' })).toThrow(
      /validation failed/,
    );
    const set = PermissionSet.create(props);
    expect(() => set.change({ name: '' }, NOW)).toThrow(/validation failed/);
    expect(set.props.name).toBe('n');
    set.change({ actions: ['c:d'] }, new Date(1));
    expect(set.props.actions).toEqual(['c:d']);
    expect(set.props.updatedAt).toEqual(new Date(1));
  });
});
