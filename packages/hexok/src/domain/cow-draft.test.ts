import { describe, expect, it } from 'vitest';
import { applyCowDraft, frozenSnapshot } from './cow-draft.js';

describe('applyCowDraft', () => {
  it('writes nested fields on a frozen snapshot without mutating it', () => {
    const root = frozenSnapshot({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    const result = applyCowDraft(root, undefined, (draft) => {
      draft.address.city = 'Denver';
      draft.address.region = 'CO';
    });
    expect(result.wrote).toBe(true);
    expect(result.root).not.toBe(root);
    expect(result.root.address).toEqual({ city: 'Denver', region: 'CO' });
    expect(root.address).toEqual({ city: 'Austin', region: 'TX' });
    expect(Object.isFrozen(root)).toBe(true);
    expect(Object.isFrozen(root.address)).toBe(true);
  });

  it('writes scalars on a frozen snapshot without mutating it', () => {
    const root = frozenSnapshot({ id: '1', title: 'Seeded' });
    const result = applyCowDraft(root, undefined, (draft) => {
      draft.title = 'Renamed';
    });
    expect(result.wrote).toBe(true);
    expect(result.root).not.toBe(root);
    expect(result.root.title).toBe('Renamed');
    expect(root.title).toBe('Seeded');
  });

  it('writes frozen array indexes without mutating the snapshot', () => {
    const root = frozenSnapshot({ items: ['a', 'b'] });
    const result = applyCowDraft(root, undefined, (draft) => {
      draft.items[0] = 'z';
    });
    expect(result.wrote).toBe(true);
    expect(result.root.items).toEqual(['z', 'b']);
    expect(root.items).toEqual(['a', 'b']);
    expect(Object.isFrozen(root.items)).toBe(true);
  });

  it('no-op on a frozen snapshot keeps the same root', () => {
    const root = frozenSnapshot({
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    });
    const result = applyCowDraft(root, undefined, (draft) => {
      void draft.address.city;
    });
    expect(result.wrote).toBe(false);
    expect(result.root).toBe(root);
    expect(result.owned).toBeUndefined();
  });

  it('unfrozen nested write still copies the path', () => {
    const root = {
      id: 'hq',
      address: { city: 'Austin', region: 'TX' },
    };
    const result = applyCowDraft(root, undefined, (draft) => {
      draft.address.city = 'Denver';
    });
    expect(result.wrote).toBe(true);
    expect(result.root).not.toBe(root);
    expect(result.root.address).not.toBe(root.address);
    expect(result.root.address.city).toBe('Denver');
    expect(root.address.city).toBe('Austin');
  });
});
