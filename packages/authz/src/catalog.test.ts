import { describe, expect, it } from 'vitest';
import {
  Authz,
  type Catalog,
  type CatalogAction,
  defineCatalog,
  MemoryTupleStore,
} from './index.js';

const catalog = defineCatalog({
  objects: {
    org: {},
    region: { parent: ['org'] },
    scan: { parent: ['location'] },
    location: {},
    user: {},
    group: {},
  },
  relations: {
    viewer: ['user', 'group'],
    editor: ['user', 'group'],
  },
  permissions: {
    'scan:view': 'viewer+parent->viewer',
    'scan:edit': 'editor + parent -> editor',
  },
} as const);

type Action = CatalogAction<typeof catalog>;
const listed: Action = 'scan:view';
void listed;

describe('defineCatalog', () => {
  it('returns the same catalog', () => {
    expect(defineCatalog(catalog)).toBe(catalog);
  });

  it('rejects a catalog that cannot be evaluated', () => {
    const cases: Array<{ catalog: Catalog; message: RegExp }> = [
      {
        catalog: {
          objects: {},
          relations: {},
          permissions: {},
        },
        message: /at least one object type/,
      },
      {
        catalog: {
          objects: { Region: {} },
          relations: {},
          permissions: {},
        },
        message: /not an identifier/,
      },
      {
        catalog: {
          objects: { user: {} },
          relations: { parent: ['user'] },
          permissions: {},
        },
        message: /reserved/,
      },
      {
        catalog: {
          objects: { user: {}, region: { parent: ['country'] } },
          relations: {},
          permissions: {},
        },
        message: /parent type "country" is unknown/,
      },
      {
        catalog: {
          objects: { user: {}, region: { parent: ['user', 'user'] } },
          relations: {},
          permissions: {},
        },
        message: /more than once/,
      },
      {
        catalog: {
          objects: { user: {} },
          relations: { viewer: [] },
          permissions: {},
        },
        message: /at least one subject type/,
      },
      {
        catalog: {
          objects: { user: {} },
          relations: { viewer: ['org'] },
          permissions: {},
        },
        message: /unknown subject type "org"/,
      },
      {
        catalog: {
          objects: { user: {} },
          relations: { viewer: ['user'] },
          permissions: { view: 'viewer' },
        },
        message: /must be type:name/,
      },
      {
        catalog: {
          objects: { user: {} },
          relations: { viewer: ['user'] },
          permissions: { 'missing:view': 'viewer' },
        },
        message: /unknown object "missing"/,
      },
      {
        catalog: {
          objects: { user: {}, scan: {} },
          relations: { viewer: ['user'] },
          permissions: { 'scan:view': '' },
        },
        message: /empty expression/,
      },
      {
        catalog: {
          objects: { user: {}, scan: {} },
          relations: { viewer: ['user'] },
          permissions: { 'scan:view': 'viewer +' },
        },
        message: /empty clause/,
      },
      {
        catalog: {
          objects: { user: {}, scan: {} },
          relations: { viewer: ['user'] },
          permissions: { 'scan:view': 'nope' },
        },
        message: /unknown relation "nope"/,
      },
      {
        catalog: {
          objects: { user: {}, scan: {} },
          relations: { viewer: ['user'] },
          permissions: { 'scan:view': 'folder->viewer' },
        },
        message: /unknown tupleset "folder"/,
      },
      {
        catalog: {
          objects: { user: {}, scan: {} },
          relations: { viewer: ['user'] },
          permissions: { 'scan:view': 'parent->parent' },
        },
        message: /unknown relation "parent"/,
      },
    ];

    for (const entry of cases) {
      expect(() => defineCatalog(entry.catalog), entry.message.source).toThrow(
        entry.message,
      );
      expect(() => new Authz(entry.catalog, new MemoryTupleStore())).toThrow(
        entry.message,
      );
    }
  });
});

// @ts-expect-error scan:delete is not a catalog action
const unknownAction: Action = 'scan:delete';
void unknownAction;
