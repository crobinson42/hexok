# @hexok/authz

Relationship authorization. Install with `npm i @hexok/authz`.

A check asks whether an actor can perform an action on one resource. A list asks which resources of one type allow that action. Both answers come from relationship tuples and a catalog. Domain entities do not store grants. Repositories receive ids from the caller.

```ts
import { Authz, defineCatalog, MemoryTupleStore } from '@hexok/authz';
```

## Catalog

The catalog is the product-specific part. Object types, the subject types of each relation, and permission expressions live there. `defineCatalog` keeps the action names as a union, so an unknown action is a compile error. Pass the catalog with `as const`.

```ts
const catalog = defineCatalog({
  objects: {
    org: {},
    region: { parent: ['org'] },
    location: { parent: ['region', 'org'] },
    scan: { parent: ['location'] },
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
  },
} as const);

type Action = CatalogAction<typeof catalog>;
```

`parent` on an object lists the types that may contain it. `parent` is reserved and is not a permission relation.

A permission expression is a union of clauses separated by `+`.

- `viewer` is that relation on the resource.
- `editor` is that relation on the resource. Add it to a view permission when an editor of the resource should pass the check.
- `parent->viewer` is `viewer` on any ancestor reached by following `parent`. The walk visits every ancestor.
- `parent->editor` is the same walk for `editor`. Add it when an editor of an ancestor should pass the check.

A clause checks the relation it names. `editor` does not also walk parents. The word before `->` is the relation to follow. `parent` is the hierarchy. Another relation, such as `member->viewer`, follows that relation instead.

## Tuples

A tuple says that a subject has a relation to an object. Refs are `type:id`. A subject may be `type:id#relation`. The id may contain colons. It cannot contain `#` or whitespace.

```ts
const authz = new Authz(catalog, new MemoryTupleStore());

await authz.write([
  { object: 'group:night-crew', relation: 'member', subject: 'user:alice' },
  { object: 'region:west', relation: 'parent', subject: 'org:acme' },
  { object: 'location:gate-a', relation: 'parent', subject: 'region:west' },
  { object: 'scan:91', relation: 'parent', subject: 'location:gate-a' },
  { object: 'region:west', relation: 'viewer', subject: 'group:night-crew' },
]);
```

The product writes a tuple when membership, hierarchy, or a share changes. It deletes that tuple when the relationship ends. `write` and `delete` are idempotent. A batch is checked before any tuple is stored.

`parent` points from the child to its parent. A location in another organization is the same shape of tuple. A share is a `viewer` or `editor` tuple.

A subject whose type differs from the actor is expanded through `member` when the catalog defines `member`. `group:night-crew` on a viewer tuple includes users who are members of that group, including nested groups. `user:alice` matches that user. An actor `{ id: 'night-crew', type: 'group' }` matches the subject `group:night-crew` directly. `group:night-crew#editor` follows `editor` instead. `user:alice#member` follows `member` on that user. Membership grants an action when a subject expands through it, or when a permission expression names it. A member tuple on an organization does not by itself grant `scan:view`.

## Checks and lists

The product builds an actor after authentication. `id` is the product's stable subject id. The default type is `user`, so `{ id: 'alice' }` is `user:alice`. Pass `type` when the principal is another object type in the catalog.

```ts
const actor = { id: 'alice' };

const allowed = await authz.check({
  actor,
  action: 'scan:edit',
  resource: { type: 'scan', id: '91' },
});

const visibleIds = await authz.list({
  actor,
  action: 'scan:view',
  type: 'scan',
});
```

`check` returns false when no tuple path grants the action. `list` returns the sorted ids of objects of that type that `check` would allow. An object is a candidate after a tuple names it as `object`. The product applies those ids in its own query.

`explain` returns the first granting path. Clauses run in expression order, and tuples run in write order. `allowed: false` comes with an empty `steps` array.

```ts
await authz.delete({
  object: 'region:west',
  relation: 'viewer',
  subject: 'group:night-crew',
});
```

## Add a type

Add the object and a permission. Write a `parent` tuple when a resource is created.

```ts
note: { parent: ['scan', 'location'] },
```

```ts
'note:view': 'viewer + editor + parent->viewer + parent->editor',
'note:edit': 'editor + parent->editor',
```

```ts
await authz.write({
  object: `note:${noteId}`,
  relation: 'parent',
  subject: `scan:${scanId}`,
});
```

`check` and `list` then accept `'note:view'` and `'note:edit'`. The resource type and the list type have to match the type named by the action.

## Store

`MemoryTupleStore` keeps the tuple set in the process. `TupleStore` is the boundary for a later adapter. `reader()` prepares a synchronous view, and the walk reads that view. An adapter may load tuples inside `reader()`. This package has no database driver and does not import `hexok`.

`Authz` checks tuples against the catalog before they reach the store. An unknown type, an unknown relation, or an illegal parent throws `AuthzError`. A relationship chain longer than 32 steps throws `AuthzError`. A denied check does not throw.
