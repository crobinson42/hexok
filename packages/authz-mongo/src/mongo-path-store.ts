import { type PathDoc, PathStore, type PathUpdate } from '@hexok/authz';
import { Adapter } from 'hexok';
import type { Collection, Db } from 'mongodb';

type PathRow = {
  _id: string;
  orgId: string;
  path: string[];
  parents: string[];
  resourceId?: unknown;
};

function toDoc(row: PathRow): PathDoc {
  return {
    id: row._id,
    orgId: row.orgId,
    path: row.path,
    parents: row.parents,
    ...(row.resourceId !== undefined ? { resourceId: row.resourceId } : {}),
  };
}

/** Owns `authz_paths` in the database it is given. Use one per database. */
export class MongoPathStore extends Adapter(PathStore) {
  private readonly paths: Collection<PathRow>;

  constructor(
    deps: { readonly db: Db },
    config: { readonly prefix?: string } = {},
  ) {
    super();
    this.paths = deps.db.collection<PathRow>(
      `${config.prefix ?? 'authz_'}paths`,
    );
  }

  /** Creates the indexes. Two records cannot share one `resourceId`. */
  override async start(): Promise<void> {
    await this.paths.createIndex({ path: 1 });
    await this.paths.createIndex({ orgId: 1 });
    await this.paths.createIndex(
      { resourceId: 1 },
      { unique: true, sparse: true },
    );
  }

  override async get(ids: readonly string[]): Promise<readonly PathDoc[]> {
    const rows = await this.paths.find({ _id: { $in: [...ids] } }).toArray();
    return rows.map(toDoc);
  }

  override async descendants(id: string): Promise<readonly PathDoc[]> {
    const rows = await this.paths.find({ path: id }).toArray();
    return rows.map(toDoc);
  }

  override async put(doc: PathDoc): Promise<void> {
    await this.paths.replaceOne(
      { _id: doc.id },
      {
        orgId: doc.orgId,
        path: [...doc.path],
        parents: [...doc.parents],
        ...(doc.resourceId !== undefined ? { resourceId: doc.resourceId } : {}),
      },
      { upsert: true },
    );
  }

  override async update(docs: readonly PathUpdate[]): Promise<void> {
    if (docs.length === 0) return;
    await this.paths.bulkWrite(
      docs.map(({ id, path, parents }) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { path: [...path], parents: [...parents] } },
        },
      })),
    );
  }

  override async remove(id: string): Promise<void> {
    await this.paths.deleteMany({ path: id });
  }
}
