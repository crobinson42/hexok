import {
  type AccessFilter,
  type Actor,
  Authz,
  evaluate,
  Grant,
  MANAGE,
  type PathStore,
  Paths,
  PermissionSet,
  type PolicyStore,
  Principals,
  resolveGrants,
} from '@hexok/authz';
import { Adapter } from 'hexok';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** What the suite drives. Wrap the adapter's stores and a real list query in it. */
export interface AgreementSubject {
  readonly policies: PolicyStore;
  readonly central: PathStore;
  /** The database that holds the resource records. */
  readonly copy: PathStore;
  /** The value a record's own `_id` holds. Return more than one type, such as ObjectId and string. */
  resourceId(id: string): unknown;
  /** Stores one resource record in the same database as `copy`. */
  addRecord(id: string, resourceId: unknown): Promise<void>;
  /** The ids of the resource records the adapter's query returns for `filter`. */
  query(filter: AccessFilter): Promise<readonly string[]>;
  cleanup?(): Promise<void>;
}

const ACTIONS = ['r:read', 'r:edit', 'r:delete'] as const;
const CATALOG = [...ACTIONS, MANAGE];

const FOLDERS: readonly (readonly [string, string?])[] = [
  ['region:w', 'org:a'],
  ['region:e', 'org:a'],
  ['loc:w1', 'region:w'],
  ['loc:w2', 'region:w'],
  ['loc:e1', 'region:e'],
  ['rtc:ops', 'org:a'],
  ['rt:inc', 'rtc:ops'],
  ['rt:sec', 'rtc:ops'],
  ['region:b', 'org:b'],
];

const RECORDS: readonly (readonly [string, readonly string[]])[] = [
  ['scan:w1', ['loc:w1']],
  ['scan:w2', ['loc:w2']],
  ['scan:e1', ['loc:e1']],
  ['note:w1', ['scan:w1']],
  ['note:deep', ['note:w1']],
  ['note:e1', ['scan:e1']],
  ['report:w1-inc', ['loc:w1', 'rt:inc']],
  ['report:w1-sec', ['loc:w1', 'rt:sec']],
  ['report:w2-inc', ['loc:w2', 'rt:inc']],
  ['report:e1-inc', ['loc:e1', 'rt:inc']],
  ['scan:b', ['region:b']],
];

const SETS: Readonly<Record<string, readonly string[]>> = {
  'set:read': ['r:read'],
  'set:write': ['r:read', 'r:edit', 'r:delete'],
  'set:no-delete': ['r:delete'],
  'set:stale': ['r:read', 'r:removed'],
  'set:manage': [MANAGE],
};

/** subject, set, folders, effect */
const GRANTS: readonly (readonly [
  string,
  string,
  readonly string[],
  'allow' | 'deny',
])[] = [
  ['group:crew', 'set:read', ['region:w'], 'allow'],
  ['group:crew', 'set:write', ['loc:w1'], 'allow'],
  ['group:crew', 'set:no-delete', ['loc:w1'], 'deny'],
  ['group:inc', 'set:read', ['rt:inc'], 'allow'],
  ['group:inc', 'set:read', ['loc:w1', 'rt:sec'], 'allow'],
  ['group:inc', 'set:no-delete', ['loc:e1', 'rt:inc'], 'deny'],
  ['group:inc', 'set:write', ['rt:inc'], 'allow'],
  ['user:deny', 'set:write', ['org:a'], 'allow'],
  ['user:deny', 'set:write', ['scan:w1'], 'deny'],
  ['user:deny', 'set:read', ['region:e'], 'deny'],
  ['user:stale', 'set:stale', ['region:w'], 'allow'],
  ['user:record', 'set:read', ['report:w2-inc'], 'allow'],
  ['user:owner', 'set:owner', ['org:a'], 'allow'],
  ['user:b', 'set:write', ['org:b'], 'allow'],
  ['user:cross', 'set:write', ['org:b'], 'allow'],
];

const MEMBERS: readonly (readonly [string, string, readonly string[]])[] = [
  ['user:crew', 'org:a', ['group:crew']],
  ['user:inc', 'org:a', ['group:inc']],
  ['user:both', 'org:a', ['group:crew', 'group:inc']],
  ['user:deny', 'org:a', []],
  ['user:stale', 'org:a', []],
  ['user:record', 'org:a', []],
  ['user:owner', 'org:a', []],
  ['user:none', 'org:a', []],
  ['user:b', 'org:b', []],
  ['user:cross', 'org:a', []],
];

class MatrixPrincipals extends Adapter(Principals) {
  override async memberships(subject: string, orgId?: string) {
    return MEMBERS.filter(
      ([id, org]) => id === subject && (orgId === undefined || org === orgId),
    ).map(([, org, groups]) => ({ orgId: org, groups }));
  }
}

function fixtures(subject: AgreementSubject) {
  const paths = new Paths({
    central: subject.central,
    copies: { data: subject.copy },
  });
  const authz = new Authz(
    {
      policies: subject.policies,
      paths: subject.central,
      principals: new MatrixPrincipals(),
    },
    { catalog: { actions: CATALOG } },
  );
  return { paths, authz };
}

/** Seeds the matrix. Exported so a suite can inspect it. */
export async function seedAgreement(subject: AgreementSubject): Promise<void> {
  const { paths } = fixtures(subject);
  const createdAt = new Date(0);
  await paths.place({ id: 'org:a' });
  await paths.place({ id: 'org:b' });
  for (const [id, parent] of FOLDERS) {
    await paths.place({ id, ...(parent !== undefined ? { parent } : {}) });
  }
  for (const [id, parents] of RECORDS) {
    const resourceId = subject.resourceId(id);
    await paths.place({ id, parents, resourceId }, 'data');
    await subject.addRecord(id, resourceId);
  }
  // A record with no path yet. Every query must leave it out.
  await subject.addRecord('scan:unplaced', subject.resourceId('scan:unplaced'));

  const sets = [...Object.entries(SETS), ['set:owner', []] as const];
  for (const [id, actions] of sets) {
    for (const orgId of ['org:a', 'org:b']) {
      const stored = orgId === 'org:a' ? id : `${id}:b`;
      await subject.policies.saveSet(
        PermissionSet.create({
          id: stored,
          orgId,
          name: stored,
          actions,
          allActions: id === 'set:owner',
          createdBy: 'user:seed',
          createdAt,
          updatedAt: createdAt,
        }),
      );
    }
  }
  let sequence = 0;
  for (const [grantee, setId, folders, effect] of GRANTS) {
    sequence += 1;
    const inB = grantee === 'user:b';
    await subject.policies.saveGrant(
      Grant.create({
        id: `grant:${sequence}`,
        orgId: inB ? 'org:b' : 'org:a',
        subject: grantee,
        setId: inB ? `${setId}:b` : setId,
        folders,
        effect,
        createdBy: 'user:seed',
        createdAt,
      }),
    );
  }
}

function actorsWithCeilings(actor: Actor): readonly Actor[] {
  return [
    actor,
    {
      ...actor,
      ceiling: [
        { actions: ['r:read'], folders: ['region:w'] },
        { actions: ['r:edit'], folders: ['loc:w1', 'rt:inc'] },
      ],
    },
    { ...actor, ceiling: [] },
  ];
}

/**
 * Every disagreement between the adapter's query and the pure evaluator, plus
 * every copy whose path differs from central. Empty means they agree.
 */
export async function findDisagreements(
  subject: AgreementSubject,
): Promise<readonly string[]> {
  const { authz } = fixtures(subject);
  const ids = [...RECORDS.map(([id]) => id), 'scan:unplaced'];
  const central = await subject.central.get(ids);
  const copies = await subject.copy.get(ids);
  const problems: string[] = [];

  for (const doc of central) {
    const copy = copies.find((candidate) => candidate.id === doc.id);
    if (JSON.stringify(copy?.path) !== JSON.stringify(doc.path)) {
      problems.push(`${doc.id}: copy path differs from central`);
    }
  }

  for (const [member, orgId] of MEMBERS) {
    const base = await authz.actor(member, orgId);
    const grants = resolveGrants(
      await subject.policies.grantsFor(orgId, base.principals),
      CATALOG,
    );
    for (const actor of actorsWithCeilings(base)) {
      const label = `${member} ceiling=${JSON.stringify(actor.ceiling)}`;
      const view = authz.forActor(actor);
      const allowed = await view.allowed(ids);
      for (const action of [...CATALOG, 'r:removed']) {
        const expected = central
          .filter((doc) => evaluate(action, doc, actor, grants))
          .map((doc) => doc.id)
          .sort();
        const filter = await view.filter(action);
        const actual = [...(await subject.query(filter))].sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          problems.push(
            `${label} ${action}: query ${actual.join()} evaluator ${expected.join()}`,
          );
        }
        const viaAllowed = ids
          .filter((id) => allowed[id]?.includes(action))
          .sort();
        if (JSON.stringify(viaAllowed) !== JSON.stringify(expected)) {
          problems.push(
            `${label} ${action}: allowed ${viaAllowed.join()} evaluator ${expected.join()}`,
          );
        }
      }
    }
  }
  return problems;
}

/**
 * Asserts that the records an adapter's query returns are exactly the records
 * the pure evaluator allows, before and after moves. Call it at the top level
 * of a test file. Pass `skip` to gate it on a service.
 */
export function describeAgreement(
  name: string,
  factory: () => Promise<AgreementSubject>,
  options: { readonly skip?: boolean } = {},
): void {
  describe.skipIf(options.skip ?? false)(`${name} agreement`, () => {
    let subject: AgreementSubject;

    beforeAll(async () => {
      subject = await factory();
      await seedAgreement(subject);
    }, 60_000);

    afterAll(async () => {
      await subject?.cleanup?.();
    });

    it('agrees on the seeded matrix', async () => {
      await expect(findDisagreements(subject)).resolves.toEqual([]);
    }, 60_000);

    it('allows someone something, so the matrix is not vacuous', async () => {
      const { authz } = fixtures(subject);
      const crew = authz.forActor(await authz.actor('user:crew'));
      const filter = await crew.filter('r:edit');
      await expect(subject.query(filter)).resolves.not.toEqual([]);
    });

    it('agrees after moving a folder and a two-parent record', async () => {
      const { paths } = fixtures(subject);
      await paths.move({ id: 'loc:w1', parent: 'region:e' });
      await paths.move({ id: 'rt:inc', parent: 'org:a' });
      await paths.move({
        id: 'report:e1-inc',
        parents: ['loc:w2', 'rt:sec'],
      });
      await expect(findDisagreements(subject)).resolves.toEqual([]);
    }, 60_000);

    it('agrees after removing a subtree', async () => {
      const { paths } = fixtures(subject);
      await paths.remove('scan:w1');
      await expect(findDisagreements(subject)).resolves.toEqual([]);
    }, 60_000);
  });
}
