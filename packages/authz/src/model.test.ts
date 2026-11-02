import { describe, expect, it } from 'vitest';
import {
  type Actor,
  evaluate,
  type GrantWithActions,
  matches,
  resolveGrants,
} from './model.js';

const actor: Actor = {
  id: 'user:sam',
  orgId: 'org:acme',
  tenants: ['org:acme'],
  principals: ['user:sam'],
};
const gateA = {
  orgId: 'org:acme',
  path: ['org:acme', 'region:west', 'loc:gate-a', 'scan:91'],
};
const dock = {
  orgId: 'org:acme',
  path: ['org:acme', 'region:east', 'loc:dock-1', 'scan:94'],
};
const report = {
  orgId: 'org:acme',
  path: ['org:acme', 'region:west', 'loc:gate-a', 'rt:incident', 'report:5'],
};

function grant(
  effect: 'allow' | 'deny',
  folders: readonly string[],
  actions: readonly string[] = ['scan:read'],
): GrantWithActions {
  return { id: 'g', effect, folders, actions, allActions: false };
}

describe('evaluate', () => {
  const cases: {
    name: string;
    grants: readonly GrantWithActions[];
    record: typeof gateA;
    actor?: Actor;
    expected: boolean;
  }[] = [
    { name: 'default deny', grants: [], record: gateA, expected: false },
    {
      name: 'allow on an ancestor',
      grants: [grant('allow', ['region:west'])],
      record: gateA,
      expected: true,
    },
    {
      name: 'allow elsewhere does not apply',
      grants: [grant('allow', ['region:west'])],
      record: dock,
      expected: false,
    },
    {
      name: 'an action does not imply another',
      grants: [grant('allow', ['region:west'], ['scan:edit'])],
      record: gateA,
      expected: false,
    },
    {
      name: 'deny wins, also from further up the tree',
      grants: [grant('allow', ['loc:gate-a']), grant('deny', ['org:acme'])],
      record: gateA,
      expected: false,
    },
    {
      name: 'allow further down cannot re-allow',
      grants: [grant('deny', ['region:west']), grant('allow', ['scan:91'])],
      record: gateA,
      expected: false,
    },
    {
      name: 'intersection applies when every folder is in the path',
      grants: [grant('allow', ['loc:gate-a', 'rt:incident'])],
      record: report,
      expected: true,
    },
    {
      name: 'intersection does not apply to one folder alone',
      grants: [grant('allow', ['loc:gate-a', 'rt:incident'])],
      record: gateA,
      expected: false,
    },
    {
      name: 'empty folders never apply, for allow',
      grants: [grant('allow', [])],
      record: gateA,
      expected: false,
    },
    {
      name: 'other organization is refused even with a matching folder',
      grants: [grant('allow', ['region:west'])],
      record: { ...gateA, orgId: 'org:globex' },
      expected: false,
    },
    {
      name: 'ceiling admits',
      grants: [grant('allow', ['org:acme'])],
      record: gateA,
      actor: {
        ...actor,
        ceiling: [{ actions: ['scan:read'], folders: ['loc:gate-a'] }],
      },
      expected: true,
    },
    {
      name: 'ceiling limits where',
      grants: [grant('allow', ['org:acme'])],
      record: dock,
      actor: {
        ...actor,
        ceiling: [{ actions: ['scan:read'], folders: ['loc:gate-a'] }],
      },
      expected: false,
    },
    {
      name: 'ceiling limits what',
      grants: [grant('allow', ['org:acme'])],
      record: gateA,
      actor: {
        ...actor,
        ceiling: [{ actions: ['scan:edit'], folders: ['org:acme'] }],
      },
      expected: false,
    },
    {
      name: 'an empty ceiling allows nothing',
      grants: [grant('allow', ['org:acme'])],
      record: gateA,
      actor: { ...actor, ceiling: [] },
      expected: false,
    },
    {
      name: 'a ceiling does not grant by itself',
      grants: [],
      record: gateA,
      actor: {
        ...actor,
        ceiling: [{ actions: ['scan:read'], folders: ['org:acme'] }],
      },
      expected: false,
    },
  ];

  it.each(cases)('$name', ({ grants, record, actor: who, expected }) => {
    expect(evaluate('scan:read', record, who ?? actor, grants)).toBe(expected);
  });

  it('follows deep nesting', () => {
    const path = Array.from({ length: 50 }, (_, depth) => `f:${depth}`);
    const deep = { orgId: 'org:acme', path };
    expect(evaluate('scan:read', deep, actor, [grant('allow', ['f:7'])])).toBe(
      true,
    );
    expect(evaluate('scan:read', deep, actor, [grant('allow', ['f:50'])])).toBe(
      false,
    );
  });
});

describe('resolveGrants', () => {
  it('drops actions a newer release removed', () => {
    const [resolved] = resolveGrants(
      [grant('allow', ['org:acme'], ['scan:read', 'scan:gone'])],
      ['scan:read'],
    );
    expect(resolved?.actions).toEqual(['scan:read']);
  });

  it('expands allActions to the current catalog', () => {
    const [resolved] = resolveGrants(
      [{ ...grant('allow', ['org:acme'], []), allActions: true }],
      ['scan:read', 'scan:new'],
    );
    expect(resolved?.actions).toEqual(['scan:read', 'scan:new']);
  });
});

describe('matches', () => {
  it('treats an empty list as no match, whichever arm holds it', () => {
    const base = { orgIds: ['org:acme'], deny: [] };
    expect(matches({ ...base, allow: [] }, gateA)).toBe(false);
    expect(matches({ ...base, allow: [[]] }, gateA)).toBe(false);
    expect(matches({ ...base, allow: [['org:acme']], within: [] }, gateA)).toBe(
      false,
    );
    expect(
      matches(
        { orgIds: ['org:acme'], allow: [['org:acme']], deny: [[]] },
        gateA,
      ),
    ).toBe(true);
  });
});
