import { describe, expect, it } from 'vitest';
import { Authz, defineCatalog, MemoryTupleStore, type Tuple } from './index.js';

const therms = defineCatalog({
  objects: {
    org: {},
    region: { parent: ['org'] },
    location: { parent: ['region', 'org'] },
    scan: { parent: ['location'] },
    note: { parent: ['scan', 'location'] },
    group: {},
    user: {},
  },
  relations: {
    member: ['user', 'group'],
    viewer: ['user', 'group'],
    editor: ['user', 'group'],
  },
  permissions: {
    'scan:view': 'viewer + editor + parent->viewer + parent->editor',
    'scan:edit': 'editor + parent->editor',
    'note:view': 'viewer + editor + parent->viewer + parent->editor',
    'note:edit': 'editor + parent->editor',
  },
} as const);

const alice = { id: 'alice' };

function open() {
  return new Authz(therms, new MemoryTupleStore());
}

async function world() {
  const authz = open();
  await authz.write([
    { object: 'group:night-crew', relation: 'member', subject: 'user:alice' },
    { object: 'group:day-crew', relation: 'member', subject: 'user:erin' },
    {
      object: 'group:night-crew',
      relation: 'member',
      subject: 'group:day-crew',
    },
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
    {
      object: 'location:gate-a',
      relation: 'viewer',
      subject: 'user:contractor',
    },
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
  ]);
  return authz;
}

describe('relationship checks', () => {
  it('follows parent, group membership, and direct editor', async () => {
    const authz = await world();

    expect(
      await authz.list({ actor: alice, action: 'scan:view', type: 'scan' }),
    ).toEqual(['91', '92']);
    expect(
      await authz.check({
        actor: alice,
        action: 'scan:edit',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(false);
    expect(
      await authz.list({
        actor: { id: 'erin' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['91', '92']);
    expect(
      await authz.list({
        actor: { id: 'dave' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual([]);
    expect(
      await authz.list({
        actor: { id: 'helen' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['50', '91', '92', '93']);
    expect(
      await authz.check({
        actor: { id: 'helen' },
        action: 'scan:view',
        resource: { type: 'scan', id: '7' },
      }),
    ).toBe(false);
    expect(
      await authz.list({
        actor: { id: 'bob' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['92']);
    expect(
      await authz.list({
        actor: { id: 'bob' },
        action: 'scan:edit',
        type: 'scan',
      }),
    ).toEqual(['92']);
    expect(
      await authz.list({
        actor: { id: 'bob' },
        action: 'note:edit',
        type: 'note',
      }),
    ).toEqual(['6']);
    expect(
      await authz.list({
        actor: { id: 'carol' },
        action: 'scan:edit',
        type: 'scan',
      }),
    ).toEqual(['93']);
    expect(
      await authz.list({ actor: alice, action: 'note:view', type: 'note' }),
    ).toEqual(['5', '6']);
  });

  it('shares one resource across tenants by writing a tuple', async () => {
    const authz = await world();
    const contractor = { id: 'contractor' };
    const gina = { id: 'gina' };

    expect(
      await authz.list({
        actor: contractor,
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['91']);
    expect(
      await authz.check({
        actor: contractor,
        action: 'scan:edit',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(false);
    expect(
      await authz.list({
        actor: contractor,
        action: 'note:view',
        type: 'note',
      }),
    ).toEqual(['5']);
    expect(
      await authz.list({ actor: gina, action: 'scan:view', type: 'scan' }),
    ).toEqual(['7']);
    expect(
      await authz.check({
        actor: gina,
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(false);
    expect(
      await authz.list({
        actor: { id: 'frank' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['93']);
    expect(
      await authz.check({
        actor: { id: 'frank' },
        action: 'scan:view',
        resource: { type: 'scan', id: '7' },
      }),
    ).toBe(false);
  });

  it('denies an actor with no granting tuple', async () => {
    const authz = await world();
    expect(
      await authz.check({
        actor: { id: 'zed' },
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(false);
    expect(
      await authz.check({
        actor: { id: 'zed' },
        action: 'scan:view',
        resource: { type: 'scan', id: 'missing' },
      }),
    ).toBe(false);
    expect(
      await authz.list({
        actor: { id: 'zed' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual([]);
    expect(
      await authz.explain({
        actor: alice,
        action: 'scan:edit',
        resource: { type: 'scan', id: '91' },
      }),
    ).toEqual({
      allowed: false,
      action: 'scan:edit',
      resource: 'scan:91',
      actor: 'user:alice',
      steps: [],
    });
  });

  it('explains the granting path', async () => {
    const authz = await world();
    expect(
      await authz.explain({
        actor: alice,
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).toEqual({
      allowed: true,
      action: 'scan:view',
      resource: 'scan:91',
      actor: 'user:alice',
      steps: [
        {
          object: 'scan:91',
          relation: 'parent',
          subject: 'location:gate-a',
          via: 'ancestor',
        },
        {
          object: 'location:gate-a',
          relation: 'parent',
          subject: 'region:west',
          via: 'ancestor',
        },
        {
          object: 'region:west',
          relation: 'viewer',
          subject: 'group:night-crew',
          via: 'userset',
        },
        {
          object: 'group:night-crew',
          relation: 'member',
          subject: 'user:alice',
          via: 'direct',
        },
      ],
    });
  });

  it('treats a group actor as that group ref', async () => {
    const authz = await world();
    expect(
      await authz.list({
        actor: { id: 'night-crew', type: 'group' },
        action: 'scan:view',
        type: 'scan',
      }),
    ).toEqual(['91', '92']);
  });

  it('does not let one user inherit another user grant', async () => {
    const authz = open();
    await authz.write([
      { object: 'location:gate-a', relation: 'parent', subject: 'region:west' },
      { object: 'scan:91', relation: 'parent', subject: 'location:gate-a' },
      { object: 'scan:91', relation: 'viewer', subject: 'user:alice' },
      { object: 'user:alice', relation: 'member', subject: 'user:bob' },
      { object: 'scan:94', relation: 'parent', subject: 'location:gate-a' },
      { object: 'scan:94', relation: 'viewer', subject: 'user:alice#member' },
    ]);

    expect(
      await authz.check({
        actor: { id: 'bob' },
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(false);
    expect(
      await authz.check({
        actor: alice,
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).toBe(true);
    expect(
      await authz.check({
        actor: { id: 'bob' },
        action: 'scan:view',
        resource: { type: 'scan', id: '94' },
      }),
    ).toBe(true);
  });

  it('sorts list ids and removes access when the tuple is deleted', async () => {
    const authz = open();
    const grant: Tuple = {
      object: 'region:west',
      relation: 'viewer',
      subject: 'user:alice',
    };
    await authz.write({
      object: 'location:gate-a',
      relation: 'parent',
      subject: 'region:west',
    });
    await authz.write([
      { object: 'scan:92', relation: 'parent', subject: 'location:gate-a' },
      { object: 'scan:91', relation: 'parent', subject: 'location:gate-a' },
    ]);
    await authz.write(grant);
    await authz.write(grant);

    expect(
      await authz.list({ actor: alice, action: 'scan:view', type: 'scan' }),
    ).toEqual(['91', '92']);

    await authz.delete(grant);
    await authz.delete(grant);
    expect(
      await authz.list({ actor: alice, action: 'scan:view', type: 'scan' }),
    ).toEqual([]);
  });

  it('rejects an illegal tuple and writes none of the batch', async () => {
    const authz = open();
    const batch: Tuple[] = [
      { object: 'scan:91', relation: 'parent', subject: 'location:gate-a' },
      { object: 'scan:91', relation: 'nope', subject: 'user:alice' },
    ];
    await expect(authz.write(batch)).rejects.toThrow(/unknown relation "nope"/);
    expect(
      await authz.list({ actor: alice, action: 'scan:view', type: 'scan' }),
    ).toEqual([]);

    await expect(
      authz.write({
        object: 'org:acme',
        relation: 'parent',
        subject: 'region:west',
      }),
    ).rejects.toThrow(/cannot have a parent/);
    await expect(
      authz.write({
        object: 'location:gate-a',
        relation: 'parent',
        subject: 'user:alice',
      }),
    ).rejects.toThrow(/parent must be region or org/);
    await expect(
      authz.write({
        object: 'location:gate-a',
        relation: 'parent',
        subject: 'region:west#member',
      }),
    ).rejects.toThrow(/concrete object/);
    await expect(
      authz.write({
        object: 'scan:91',
        relation: 'viewer',
        subject: 'org:acme',
      }),
    ).rejects.toThrow(/does not allow subject type org/);
    await expect(
      authz.write({
        object: 'scan:91',
        relation: 'viewer',
        subject: 'group:night#nope',
      }),
    ).rejects.toThrow(/unknown userset relation "nope"/);
    await expect(
      authz.write({
        object: 'Scan:91',
        relation: 'viewer',
        subject: 'user:alice',
      }),
    ).rejects.toThrow(/invalid object ref/);
    await expect(
      authz.check({
        actor: { id: '' },
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).rejects.toThrow(/invalid actor id/);
    await expect(
      authz.check({
        actor: { id: 'night-crew', type: 'crew' },
        action: 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).rejects.toThrow(/unknown actor type "crew"/);
    await expect(
      authz.check({
        actor: alice,
        action: 'scan:delete' as 'scan:view',
        resource: { type: 'scan', id: '91' },
      }),
    ).rejects.toThrow(/unknown action/);
    await expect(
      authz.check({
        actor: alice,
        action: 'scan:view',
        resource: { type: 'note' as 'scan', id: '5' },
      }),
    ).rejects.toThrow(/applies to scan, not note/);
  });
});

describe('permission expressions', () => {
  it('does not treat editor as parent editor unless the expression says so', async () => {
    const catalog = defineCatalog({
      objects: {
        folder: {},
        scan: { parent: ['folder'] },
        user: {},
      },
      relations: {
        viewer: ['user'],
        editor: ['user'],
      },
      permissions: {
        'scan:view': 'viewer + parent->viewer + editor',
      },
    } as const);
    const authz = new Authz(catalog, new MemoryTupleStore());
    await authz.write([
      { object: 'scan:1', relation: 'parent', subject: 'folder:plans' },
      { object: 'scan:1', relation: 'editor', subject: 'user:ada' },
      { object: 'folder:plans', relation: 'editor', subject: 'user:bea' },
      { object: 'folder:plans', relation: 'viewer', subject: 'user:cam' },
    ]);

    expect(
      await authz.check({
        actor: { id: 'ada' },
        action: 'scan:view',
        resource: { type: 'scan', id: '1' },
      }),
    ).toBe(true);
    expect(
      await authz.check({
        actor: { id: 'bea' },
        action: 'scan:view',
        resource: { type: 'scan', id: '1' },
      }),
    ).toBe(false);
    expect(
      await authz.check({
        actor: { id: 'cam' },
        action: 'scan:view',
        resource: { type: 'scan', id: '1' },
      }),
    ).toBe(true);
  });

  it('follows a tupleset other than parent', async () => {
    const catalog = defineCatalog({
      objects: { doc: {}, group: {}, user: {} },
      relations: {
        member: ['user', 'group'],
        viewer: ['user'],
      },
      permissions: { 'doc:view': 'viewer + member->viewer' },
    } as const);
    const authz = new Authz(catalog, new MemoryTupleStore());
    await authz.write([
      { object: 'doc:1', relation: 'member', subject: 'group:owners' },
      { object: 'group:owners', relation: 'viewer', subject: 'user:alice' },
    ]);
    expect(
      await authz.check({
        actor: alice,
        action: 'doc:view',
        resource: { type: 'doc', id: '1' },
      }),
    ).toBe(true);
    expect(
      await authz.list({ actor: alice, action: 'doc:view', type: 'doc' }),
    ).toEqual(['1']);
  });

  it('uses the actor type when it is not user', async () => {
    const catalog = defineCatalog({
      objects: { document: {}, account: {} },
      relations: { viewer: ['account'] },
      permissions: { 'document:view': 'viewer' },
    } as const);
    const authz = new Authz(catalog, new MemoryTupleStore());
    await authz.write({
      object: 'document:1',
      relation: 'viewer',
      subject: 'account:a',
    });
    await expect(
      authz.check({
        actor: { id: 'a' },
        action: 'document:view',
        resource: { type: 'document', id: '1' },
      }),
    ).rejects.toThrow(/unknown actor type "user"/);
    expect(
      await authz.check({
        actor: { id: 'a', type: 'account' },
        action: 'document:view',
        resource: { type: 'document', id: '1' },
      }),
    ).toBe(true);
    expect(
      await authz.check({
        actor: { id: 'acme:a', type: 'account' },
        action: 'document:view',
        resource: { type: 'document', id: '1' },
      }),
    ).toBe(false);
    await authz.write({
      object: 'document:2',
      relation: 'viewer',
      subject: 'account:acme:a',
    });
    expect(
      await authz.check({
        actor: { id: 'acme:a', type: 'account' },
        action: 'document:view',
        resource: { type: 'document', id: '2' },
      }),
    ).toBe(true);
  });
});

describe('cycles and depth', () => {
  const nodes = defineCatalog({
    objects: {
      node: { parent: ['node'] },
      user: {},
      group: {},
    },
    relations: {
      member: ['user', 'group'],
      viewer: ['user', 'group'],
    },
    permissions: { 'node:view': 'viewer + parent->viewer' },
  } as const);

  it('stops on a parent cycle and still grants a real path', async () => {
    const authz = new Authz(nodes, new MemoryTupleStore());
    await authz.write([
      { object: 'node:a', relation: 'parent', subject: 'node:b' },
      { object: 'node:b', relation: 'parent', subject: 'node:a' },
    ]);
    expect(
      await authz.check({
        actor: alice,
        action: 'node:view',
        resource: { type: 'node', id: 'a' },
      }),
    ).toBe(false);

    await authz.write({
      object: 'node:a',
      relation: 'viewer',
      subject: 'user:alice',
    });
    expect(
      await authz.check({
        actor: alice,
        action: 'node:view',
        resource: { type: 'node', id: 'b' },
      }),
    ).toBe(true);
  });

  it('stops on a membership cycle', async () => {
    const authz = new Authz(nodes, new MemoryTupleStore());
    await authz.write([
      { object: 'group:b', relation: 'member', subject: 'group:a' },
      { object: 'group:a', relation: 'member', subject: 'group:b' },
      { object: 'group:a', relation: 'member', subject: 'user:alice' },
      { object: 'group:a', relation: 'member', subject: 'group:a#member' },
      { object: 'node:a', relation: 'viewer', subject: 'group:b' },
    ]);
    expect(
      await authz.check({
        actor: alice,
        action: 'node:view',
        resource: { type: 'node', id: 'a' },
      }),
    ).toBe(true);
  });

  it('rejects a hierarchy walk that is too deep', async () => {
    const authz = new Authz(nodes, new MemoryTupleStore());
    const tuples: Tuple[] = [
      { object: 'node:0', relation: 'viewer', subject: 'user:alice' },
    ];
    for (let i = 0; i < 40; i += 1) {
      tuples.push({
        object: `node:${i + 1}`,
        relation: 'parent',
        subject: `node:${i}`,
      });
    }
    await authz.write(tuples);
    await expect(
      authz.check({
        actor: alice,
        action: 'node:view',
        resource: { type: 'node', id: '40' },
      }),
    ).rejects.toThrow(/exceeded 32 steps/);

    expect(
      await authz.check({
        actor: alice,
        action: 'node:view',
        resource: { type: 'node', id: '4' },
      }),
    ).toBe(true);
  });
});

type Therns = typeof therms;

/** Compiled by `type-check`. These calls are not executed. */
export function acceptScanView(authz: Authz<Therns>): Promise<boolean> {
  return authz.check({
    actor: { id: 'alice' },
    action: 'scan:view',
    resource: { type: 'scan', id: '91' },
  });
}

export function rejectUnknownAction(authz: Authz<Therns>): void {
  void authz.check({
    actor: { id: 'alice' },
    // @ts-expect-error scan:delete is not a catalog action
    action: 'scan:delete',
    resource: { type: 'scan', id: '91' },
  });
}

export function rejectNoteForScanView(authz: Authz<Therns>): void {
  void authz.check({
    actor: { id: 'alice' },
    action: 'scan:view',
    resource: {
      // @ts-expect-error scan:view applies to scan
      type: 'note',
      id: '5',
    },
  });
}

export function rejectScanListForNote(authz: Authz<Therns>): void {
  void authz.list({
    actor: { id: 'alice' },
    action: 'note:view',
    // @ts-expect-error note:view lists notes
    type: 'scan',
  });
}
