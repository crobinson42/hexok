import {
  type AccessFilter,
  MemoryPathStore,
  MemoryPolicyStore,
  memoryFilter,
} from '@hexok/authz';
import { describe, expect, it } from 'vitest';
import {
  type AgreementSubject,
  describeAgreement,
  findDisagreements,
  seedAgreement,
} from './agreement-suite.js';

function memorySubject(
  rewrite: (filter: AccessFilter) => AccessFilter = (filter) => filter,
): AgreementSubject {
  const copy = new MemoryPathStore();
  const records = new Map<unknown, string>();
  return {
    policies: new MemoryPolicyStore(),
    central: new MemoryPathStore(),
    copy,
    resourceId: (id) => (id.startsWith('scan:') ? { oid: id } : id),
    async addRecord(id, resourceId) {
      records.set(resourceId, id);
    },
    async query(filter) {
      return memoryFilter(copy.all(), rewrite(filter)).flatMap(
        (doc) => records.get(doc.resourceId) ?? [],
      );
    },
  };
}

describeAgreement('memory', async () => memorySubject());

describe('findDisagreements', () => {
  const broken: readonly [string, (filter: AccessFilter) => AccessFilter][] = [
    ['ignores deny', (filter) => ({ ...filter, deny: [] })],
    [
      'ignores the organization',
      (filter) => ({ ...filter, orgIds: ['org:a', 'org:b'] }),
    ],
    ['ignores the ceiling', ({ within: _within, ...filter }) => filter],
    [
      'treats an intersection as either folder',
      (filter) => ({ ...filter, allow: filter.allow.flat().map((f) => [f]) }),
    ],
  ];

  it.each(broken)('catches an adapter that %s', async (_name, rewrite) => {
    const subject = memorySubject(rewrite);
    await seedAgreement(subject);
    await expect(findDisagreements(subject)).resolves.not.toEqual([]);
  });

  it('catches a copy with a stale path', async () => {
    const subject = memorySubject();
    await seedAgreement(subject);
    await subject.copy.update([
      { id: 'scan:w1', path: ['org:a', 'scan:w1'], parents: ['org:a'] },
    ]);
    await expect(findDisagreements(subject)).resolves.not.toEqual([]);
  });
});
