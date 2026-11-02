import { describe, expect, it } from 'vitest';
import { accessStages } from './access-stages.js';

const none = [{ $match: { $expr: false } }];

describe('accessStages', () => {
  it('matches nothing for an empty allow or an empty ceiling', () => {
    expect(accessStages({ orgIds: ['o'], allow: [], deny: [] })).toEqual(none);
    expect(
      accessStages({ orgIds: ['o'], allow: [['f']], deny: [], within: [] }),
    ).toEqual(none);
  });

  it('joins on resourceId and omits an empty $nor', () => {
    const [lookup, , match] = accessStages({
      orgIds: ['o'],
      allow: [['f']],
      deny: [],
    });
    expect(lookup?.$lookup).toMatchObject({
      from: 'authz_paths',
      localField: '_id',
      foreignField: 'resourceId',
    });
    expect(match?.$match).not.toHaveProperty('$nor');
  });

  it('honors the prefix', () => {
    const [lookup] = accessStages(
      { orgIds: ['o'], allow: [['f']], deny: [] },
      { prefix: 'x_' },
    );
    expect(lookup?.$lookup.from).toBe('x_paths');
  });
});
