import { describe, expect, it } from 'vitest';
import { MemoryTupleStore } from './memory-store.js';
import type { Tuple } from './types.js';

const parent: Tuple = {
  object: 'scan:91',
  relation: 'parent',
  subject: 'location:gate-a',
};

const viewer: Tuple = {
  object: 'scan:91',
  relation: 'viewer',
  subject: 'user:alice',
};

describe('MemoryTupleStore', () => {
  it('stores a set of tuples and lists ids by type', async () => {
    const store = new MemoryTupleStore();
    await store.write([parent, viewer, parent]);
    expect(store.read('scan:91')).toEqual([parent, viewer]);
    expect(store.read('scan:91', 'viewer')).toEqual([viewer]);
    expect(store.read('scan:91', 'editor')).toEqual([]);
    expect(store.idsOfType('scan')).toEqual(['91']);
    expect(store.idsOfType('note')).toEqual([]);

    await store.delete([viewer]);
    expect(store.read('scan:91')).toEqual([parent]);
    expect(store.idsOfType('scan')).toEqual(['91']);

    await store.delete([parent, parent]);
    expect(store.read('scan:91')).toEqual([]);
    expect(store.idsOfType('scan')).toEqual([]);
  });

  it('keeps an id while any tuple still names the object', async () => {
    const store = new MemoryTupleStore();
    await store.write([
      parent,
      { object: 'scan:92', relation: 'parent', subject: 'location:gate-b' },
    ]);
    await store.delete([parent]);
    expect(store.idsOfType('scan')).toEqual(['92']);
  });

  it('rejects a malformed ref before changing the set', async () => {
    const store = new MemoryTupleStore();
    await store.write([parent]);
    await expect(
      store.write([
        viewer,
        { object: 'scan', relation: 'viewer', subject: 'user:bob' },
      ]),
    ).rejects.toThrow(/type:id/);
    expect(store.read('scan:91')).toEqual([parent]);
  });
});
