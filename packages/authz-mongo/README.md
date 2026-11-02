# @hexok/authz-mongo

MongoDB adapters for the `@hexok/authz` ports. Install with `npm i @hexok/authz-mongo mongodb`. Requires MongoDB 5.0 or newer and the `mongodb` driver 6 or 7. The application owns the driver and the connections.

Adapter classes are closed. Wrap one in your own adapter of the port when you need extra logic.

```ts
import { accessStages, MongoPathStore, MongoPolicyStore } from '@hexok/authz-mongo';

const policies = new MongoPolicyStore({ db: authzDb });
const centralPaths = new MongoPathStore({ db: authzDb });
const scansPaths = new MongoPathStore({ db: scansDb });

await policies.start();
await centralPaths.start();
await scansPaths.start();
```

`start` creates the indexes. It does not connect.

## Stores

| Class | Owns | Use |
| --- | --- | --- |
| `MongoPolicyStore` | `authz_sets`, `authz_grants` | One, in the central database. |
| `MongoPathStore` | `authz_paths` | One for the central database, and one per resource database. |

Both take `{ db }` and an optional `{ prefix }`. The default prefix is `authz_`.

## List queries

Append `accessStages` to a list repository's pipeline. Narrow with the repository's own indexes first, because each row left costs one lookup into `authz_paths`.

```ts
async list(query: { parentId: string; access: AccessFilter }) {
  return this.notes
    .aggregate([
      { $match: { parentId: query.parentId } },
      ...accessStages(query.access),
      { $sort: { updatedAt: -1 } },
    ])
    .toArray();
}
```

The stages join the resource's `_id` to `resourceId` on the path copy, in the same database. A record with no path yet is left out. An empty `allow` returns nothing. Pass `{ prefix }` as the second argument when the path store uses one.

Median times on MongoDB 7 at 100,000 scans, on one laptop:

| Query | Rows | Time |
| --- | --- | --- |
| One location, without `accessStages` | 100 | 1.7 ms |
| One location, with `accessStages` | 100 | 4.9 ms |
| Whole organization, first 50 by date | 50 | 58 ms |
| Whole organization, every match | 10,001 | 3.2 s |

Run `bench/list-100k.mjs` to measure your own hardware.

## Guarantees

- `put` is an upsert, and a repeat is safe.
- `update` writes `path` and `parents` by id. It ignores ids this database does not hold, and it does not change `resourceId`.
- A sparse unique index on `resourceId` refuses two records with one value. The driver's duplicate key error reaches the caller. Without it, a record could join another record's path.
- `saveSet` and `saveGrant` call `commit()` after the write succeeds.
- Writes across databases are not transactional. A failed write throws, and a retry finishes the work.
