import { Adapter, UseCase } from 'hexok';
import { beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { Authz, type RequestAuthz } from './authz.js';
import { type AccessAction, AccessCatalog } from './catalog.js';
import { MemoryPathStore, MemoryPolicyStore } from './memory.js';
import { Paths } from './paths.js';
import { type Membership, Principals } from './ports.js';
import {
  type Authorize,
  authorizeGuard,
  BootstrapOrganization,
  CreatePermissionSet,
  DeletePermissionSet,
  GetAccessSummary,
  GetAllowedActions,
  GrantAccess,
  ListGrants,
  RevokeGrant,
  UpdatePermissionSet,
} from './use-cases.js';

class Shop extends AccessCatalog('shop', {
  actions: ['order:read', 'order:edit', 'order:delete'],
}) {}
type Action = AccessAction<typeof Shop>;

class Everyone extends Adapter(Principals) {
  override async memberships(
    subject: string,
    orgId?: string,
  ): Promise<readonly Membership[]> {
    const org = subject.startsWith('other:') ? 'org:b' : 'org:a';
    return orgId === undefined || orgId === org
      ? [{ orgId: org, groups: [] }]
      : [];
  }
}

const AppUseCase = UseCase.context<
  { authz: RequestAuthz<Action> },
  { authorize: Authorize<Action> }
>().guard(authorizeGuard);

class ReadOrder extends AppUseCase('order.read', {
  authorize: {
    action: 'order:read',
    resource: (input: { id: string }) => input.id,
  },
}) {
  async execute(
    _ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string },
  ): Promise<string> {
    return input.id;
  }
}

class ListOrders extends AppUseCase('order.list', { authorize: null }) {
  async execute(ctx: UseCase.Ctx<typeof AppUseCase>): Promise<unknown> {
    return ctx.authz.filter('order:read');
  }
}

describe('use cases', () => {
  let policies: MemoryPolicyStore;
  let central: MemoryPathStore;
  let paths: Paths<Record<string, never>>;
  let authz: Authz<Action>;
  let admin: { policies: MemoryPolicyStore; catalog: typeof Shop };

  const as = async (subject: string) => ({
    authz: authz.forActor(await authz.actor(subject)),
  });
  const createSet = async (subject: string, actions: readonly string[]) =>
    new CreatePermissionSet(admin).execute(await as(subject), {
      name: 'set',
      actions,
    });
  const give = async (
    subject: string,
    setId: string,
    folders: readonly string[],
    who: string,
    effect: 'allow' | 'deny' = 'allow',
  ) =>
    new GrantAccess(admin).execute(await as(who), {
      subject,
      setId,
      folders,
      effect,
    });

  beforeEach(async () => {
    policies = new MemoryPolicyStore();
    central = new MemoryPathStore();
    paths = new Paths({ central, copies: {} });
    authz = new Authz(
      { policies, paths: central, principals: new Everyone() },
      { catalog: Shop },
    );
    admin = { policies, catalog: Shop };
    const bootstrap = new BootstrapOrganization({ policies, paths });
    await bootstrap.execute({ orgId: 'org:a', founder: 'user:root' });
    await bootstrap.execute({ orgId: 'org:b', founder: 'other:root' });
    await paths.place({ id: 'region:w', parent: 'org:a' });
    await paths.place({ id: 'loc:g', parent: 'region:w' });
    await paths.place({ id: 'order:1', parent: 'loc:g' });
    await paths.place({ id: 'order:b', parent: 'org:b' });
  });

  describe('BootstrapOrganization', () => {
    it('gives the founder every action, and new ones in later releases', async () => {
      const founder = await as('user:root');
      await expect(founder.authz.allowed(['order:1'])).resolves.toEqual({
        'order:1': Shop.actions,
      });
      class Later extends AccessCatalog('later', {
        actions: ['order:read', 'order:new'],
      }) {}
      const later = new Authz(
        { policies, paths: central, principals: new Everyone() },
        { catalog: Later },
      ).forActor(founder.authz.actor);
      await expect(later.can('order:new', 'order:1')).resolves.toBe(true);
    });

    it('is safe to repeat', async () => {
      const bootstrap = new BootstrapOrganization({ policies, paths });
      const before = await policies.getSet('set:owner:org:a');
      await expect(
        bootstrap.execute({ orgId: 'org:a', founder: 'user:someone-else' }),
      ).resolves.toEqual({
        setId: 'set:owner:org:a',
        grantId: 'grant:owner:org:a',
      });
      expect((await policies.getSet('set:owner:org:a'))?.props).toEqual(
        before?.props,
      );
      const someone = await as('user:someone-else');
      await expect(someone.authz.can('order:read', 'org:a')).resolves.toBe(
        false,
      );
    });
  });

  describe('permission sets', () => {
    it('Create checks the root and the catalog', async () => {
      await expect(createSet('user:sam', ['order:read'])).rejects.toMatchObject(
        { code: 'Forbidden', data: { action: 'access:manage' } },
      );
      await expect(
        createSet('user:root', ['order:gone']),
      ).rejects.toMatchObject({
        code: 'UnknownAction',
        data: { actions: ['order:gone'] },
      });
      await expect(
        createSet('user:root', ['order:read']),
      ).resolves.toMatchObject({
        orgId: 'org:a',
        actions: ['order:read'],
        createdBy: 'user:root',
      });
    });

    it('Update refuses an added action the actor does not hold at the root', async () => {
      const manage = await createSet('user:root', ['access:manage']);
      const plain = await createSet('user:root', ['order:read']);
      await give('user:mid', manage.id, ['org:a'], 'user:root');
      const update = new UpdatePermissionSet(admin);
      await expect(
        update.execute(await as('user:mid'), {
          id: plain.id,
          actions: ['order:read', 'order:delete'],
        }),
      ).rejects.toMatchObject({
        code: 'Escalation',
        data: { missing: ['order:delete'] },
      });
      await expect(
        update.execute(await as('user:mid'), {
          id: plain.id,
          actions: [],
          name: 'renamed',
        }),
      ).resolves.toMatchObject({ actions: [], name: 'renamed' });
    });

    it('Update checks the catalog and takes effect at once', async () => {
      const set = await createSet('user:root', ['order:read']);
      await give('user:sam', set.id, ['org:a'], 'user:root');
      const update = new UpdatePermissionSet(admin);
      await expect(
        update.execute(await as('user:root'), {
          id: set.id,
          actions: ['order:gone'],
        }),
      ).rejects.toMatchObject({ code: 'UnknownAction' });
      await update.execute(await as('user:root'), {
        id: set.id,
        actions: ['order:edit'],
      });
      const sam = await as('user:sam');
      await expect(sam.authz.can('order:edit', 'order:1')).resolves.toBe(true);
      await expect(sam.authz.can('order:read', 'order:1')).resolves.toBe(false);
    });

    it('Update refuses an Owner set', async () => {
      await expect(
        new UpdatePermissionSet(admin).execute(await as('user:root'), {
          id: 'set:owner:org:a',
          name: 'mine',
        }),
      ).rejects.toMatchObject({ code: 'ProtectedSet' });
    });

    it('Delete throws InUse while a grant uses the set', async () => {
      const set = await createSet('user:root', ['order:read']);
      const grant = await give('user:sam', set.id, ['org:a'], 'user:root');
      const remove = new DeletePermissionSet({ policies });
      await expect(
        remove.execute(await as('user:root'), { id: set.id }),
      ).rejects.toMatchObject({ code: 'InUse' });
      await new RevokeGrant({ policies }).execute(await as('user:root'), {
        id: grant.id,
      });
      await remove.execute(await as('user:root'), { id: set.id });
      await expect(policies.getSet(set.id)).resolves.toBeNull();
    });

    it('hides another organization behind NotFound', async () => {
      const set = await createSet('user:root', ['order:read']);
      const id = { id: set.id };
      const outsider = await as('other:root');
      const notFound = { code: 'NotFound', data: { id: set.id } };
      await expect(
        new UpdatePermissionSet(admin).execute(outsider, { ...id, name: 'x' }),
      ).rejects.toMatchObject(notFound);
      await expect(
        new DeletePermissionSet({ policies }).execute(outsider, id),
      ).rejects.toMatchObject(notFound);
      await expect(
        new GrantAccess(admin).execute(outsider, {
          subject: 'other:x',
          setId: set.id,
          folders: ['org:b'],
        }),
      ).rejects.toMatchObject(notFound);
    });
  });

  describe('GrantAccess', () => {
    it('needs access:manage where the folders meet', async () => {
      const manage = await createSet('user:root', [
        'access:manage',
        'order:read',
      ]);
      await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const read = await createSet('user:root', ['order:read']);
      await expect(
        give('user:lee', read.id, ['loc:g'], 'user:sam'),
      ).resolves.toMatchObject({ createdBy: 'user:sam', effect: 'allow' });
      await expect(
        give('user:lee', read.id, ['region:w'], 'user:sam'),
      ).rejects.toMatchObject({
        code: 'Forbidden',
        data: { action: 'access:manage' },
      });
    });

    it('refuses escalation, and a deny counts against what is held', async () => {
      const manage = await createSet('user:root', [
        'access:manage',
        'order:edit',
      ]);
      await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const edit = await createSet('user:root', ['order:edit']);
      const both = await createSet('user:root', ['order:edit', 'order:read']);
      await expect(
        give('user:lee', both.id, ['loc:g'], 'user:sam'),
      ).rejects.toMatchObject({
        code: 'Escalation',
        data: { missing: ['order:read'] },
      });
      await give('user:sam', edit.id, ['loc:g'], 'user:root', 'deny');
      await expect(
        give('user:lee', edit.id, ['loc:g'], 'user:sam'),
      ).rejects.toMatchObject({
        code: 'Escalation',
        data: { missing: ['order:edit'] },
      });
    });

    it('applies the same rule to a deny grant and an Owner set', async () => {
      const manage = await createSet('user:root', ['access:manage']);
      await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const read = await createSet('user:root', ['order:read']);
      await expect(
        give('user:lee', read.id, ['loc:g'], 'user:sam', 'deny'),
      ).rejects.toMatchObject({ code: 'Escalation' });
      await expect(
        give('user:lee', 'set:owner:org:a', ['loc:g'], 'user:sam'),
      ).rejects.toMatchObject({ code: 'Escalation' });
    });

    it('refuses folders in another organization, and unplaced ones', async () => {
      const read = await createSet('user:root', ['order:read']);
      await expect(
        give('user:lee', read.id, ['org:b'], 'user:root'),
      ).rejects.toMatchObject({ code: 'NotFound', data: { id: 'org:b' } });
      await expect(
        give('user:lee', read.id, ['loc:g', 'order:b'], 'user:root'),
      ).rejects.toMatchObject({ code: 'NotFound', data: { id: 'order:b' } });
      await expect(
        give('user:lee', read.id, ['nope'], 'user:root'),
      ).rejects.toMatchObject({ code: 'NotFound', data: { id: 'nope' } });
    });

    it('refuses empty folders', async () => {
      const read = await createSet('user:root', ['order:read']);
      await expect(
        give('user:lee', read.id, [], 'user:root'),
      ).rejects.toMatchObject({ code: 'Forbidden' });
    });

    it('ignores set actions a newer release removed', async () => {
      const read = await createSet('user:root', ['order:read']);
      const stored = await policies.getSet(read.id);
      stored?.change({ actions: ['order:read', 'order:gone'] }, new Date());
      if (stored) await policies.saveSet(stored);
      await expect(
        give('user:lee', read.id, ['loc:g'], 'user:root'),
      ).resolves.toMatchObject({ setId: read.id });
    });
  });

  describe('RevokeGrant', () => {
    it('lets a local manager revoke an allow in scope, and takes effect at once', async () => {
      const manage = await createSet('user:root', [
        'access:manage',
        'order:read',
      ]);
      await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const read = await createSet('user:root', ['order:read']);
      const inside = await give('user:lee', read.id, ['loc:g'], 'user:root');
      const wider = await give('user:lee', read.id, ['region:w'], 'user:root');
      const revoke = new RevokeGrant({ policies });
      await expect(
        revoke.execute(await as('user:sam'), { id: wider.id }),
      ).rejects.toMatchObject({ code: 'Forbidden' });
      await revoke.execute(await as('user:sam'), { id: inside.id });
      await revoke.execute(await as('user:root'), { id: wider.id });
      const lee = await as('user:lee');
      await expect(lee.authz.can('order:read', 'order:1')).resolves.toBe(false);
    });

    it('keeps a local manager from lifting a deny', async () => {
      const manage = await createSet('user:root', [
        'access:manage',
        'order:delete',
      ]);
      await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const del = await createSet('user:root', ['order:delete']);
      const deny = await give(
        'user:sam',
        del.id,
        ['loc:g'],
        'user:root',
        'deny',
      );
      const revoke = new RevokeGrant({ policies });
      await expect(
        revoke.execute(await as('user:sam'), { id: deny.id }),
      ).rejects.toMatchObject({
        code: 'Forbidden',
        data: { action: 'access:manage' },
      });
      await revoke.execute(await as('user:root'), { id: deny.id });
    });

    it('lets a root manager revoke a grant on a removed folder', async () => {
      const read = await createSet('user:root', ['order:read']);
      const grant = await give('user:lee', read.id, ['loc:g'], 'user:root');
      await paths.remove('loc:g');
      await new RevokeGrant({ policies }).execute(await as('user:root'), {
        id: grant.id,
      });
      await expect(policies.getGrant(grant.id)).resolves.toBeNull();
    });

    it('hides another organization behind NotFound', async () => {
      const read = await createSet('user:root', ['order:read']);
      const grant = await give('user:lee', read.id, ['loc:g'], 'user:root');
      await expect(
        new RevokeGrant({ policies }).execute(await as('other:root'), {
          id: grant.id,
        }),
      ).rejects.toMatchObject({ code: 'NotFound' });
    });
  });

  describe('ListGrants', () => {
    it('needs access:manage at the folder, and filters', async () => {
      const manage = await createSet('user:root', ['access:manage']);
      const grant = await give('user:sam', manage.id, ['loc:g'], 'user:root');
      const list = new ListGrants({ policies });
      await expect(
        list.execute(await as('user:sam'), { folder: 'loc:g' }),
      ).resolves.toMatchObject([{ id: grant.id }]);
      await expect(
        list.execute(await as('user:sam'), { folder: 'region:w' }),
      ).rejects.toMatchObject({ code: 'Forbidden' });
      await expect(
        list.execute(await as('user:sam'), {}),
      ).rejects.toMatchObject({ code: 'Forbidden' });
      const everything = await list.execute(await as('user:root'), {});
      expect(everything.map((row) => row.id)).toEqual([
        'grant:owner:org:a',
        grant.id,
      ]);
      await expect(
        list.execute(await as('user:root'), { subject: 'user:nobody' }),
      ).resolves.toEqual([]);
    });
  });

  describe('read use cases', () => {
    it('GetAllowedActions caps at 100 ids', async () => {
      const read = new GetAllowedActions();
      const root = await as('user:root');
      await expect(read.execute(root, { ids: ['order:1'] })).resolves.toEqual({
        'order:1': Shop.actions,
      });
      await expect(
        read.execute(root, { ids: Array(101).fill('x') }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('GetAccessSummary returns the summary', async () => {
      const summary = await new GetAccessSummary().execute(
        await as('user:root'),
      );
      expect(summary.actor).toEqual({ id: 'user:root', orgId: 'org:a' });
      expect(summary.actions['order:read']).toEqual({
        allow: [['org:a']],
        deny: [],
      });
    });
  });

  describe('authorizeGuard', () => {
    it('refuses before execute runs, also for an id with no path', async () => {
      const read = new ReadOrder();
      const root = await as('user:root');
      await expect(read.execute(root, { id: 'order:1' })).resolves.toBe(
        'order:1',
      );
      await expect(
        read.execute(await as('user:sam'), { id: 'order:1' }),
      ).rejects.toMatchObject({
        code: 'Forbidden',
        data: { action: 'order:read' },
      });
      await expect(read.execute(root, { id: 'nope' })).rejects.toMatchObject({
        code: 'Forbidden',
      });
    });

    it('lets authorize null through to execute', async () => {
      await expect(
        new ListOrders().execute(await as('user:sam')),
      ).resolves.toMatchObject({ allow: [] });
    });

    it('makes authorize and the action compile-time requirements', () => {
      // Never called. The compiler reads these lines.
      const wrong = () => {
        // @ts-expect-error authorize is required
        class Missing extends AppUseCase('x.missing') {
          async execute(): Promise<void> {}
        }
        class Unknown extends AppUseCase('x.unknown', {
          authorize: {
            // @ts-expect-error not in the catalog
            action: 'order:gone',
            resource: (input: { id: string }) => input.id,
          },
        }) {
          async execute(): Promise<void> {}
        }
        return [Missing, Unknown];
      };
      expectTypeOf(wrong).toBeFunction();
    });
  });
});
