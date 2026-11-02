import {
  type Effect,
  Grant,
  type GrantProps,
  type GrantQuery,
  type GrantWithActions,
  PermissionSet,
  type PermissionSetProps,
  PolicyStore,
} from '@hexok/authz';
import { Adapter, Mapper, type StandardSchemaV1 } from 'hexok';
import type { Collection, Db } from 'mongodb';

/** Stored shapes are written by these mappers, so reads are not rechecked. */
function stored<T>(): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'hexok-authz-mongo',
      validate: (value) => ({ value: value as T }),
    },
  };
}

type SetRow = Omit<PermissionSetProps, 'id' | 'actions'> & {
  _id: string;
  actions: string[];
};

type GrantRow = Omit<GrantProps, 'id' | 'folders'> & {
  _id: string;
  folders: string[];
};

export class MongoSetMapper extends Mapper(
  'mongo.PermissionSet',
  PermissionSet,
  stored<SetRow>(),
) {
  protected fromSource(set: PermissionSet): SetRow {
    const { id, ...props } = set.props;
    return { ...props, _id: id, actions: [...props.actions] };
  }

  protected toSource({ _id, ...row }: SetRow): PermissionSetProps {
    return { ...row, id: _id };
  }
}

export class MongoGrantMapper extends Mapper(
  'mongo.Grant',
  Grant,
  stored<GrantRow>(),
) {
  protected fromSource(grant: Grant): GrantRow {
    const { id, ...props } = grant.props;
    return { ...props, _id: id, folders: [...props.folders] };
  }

  protected toSource({ _id, ...row }: GrantRow): GrantProps {
    return { ...row, id: _id };
  }
}

/** Owns `authz_sets` and `authz_grants` in the central database. */
export class MongoPolicyStore extends Adapter(PolicyStore) {
  private readonly sets: Collection<SetRow>;
  private readonly grants: Collection<GrantRow>;
  private readonly setsName: string;
  private readonly setMapper = new MongoSetMapper();
  private readonly grantMapper = new MongoGrantMapper();

  constructor(
    deps: { readonly db: Db },
    config: { readonly prefix?: string } = {},
  ) {
    super();
    const prefix = config.prefix ?? 'authz_';
    this.setsName = `${prefix}sets`;
    this.sets = deps.db.collection<SetRow>(this.setsName);
    this.grants = deps.db.collection<GrantRow>(`${prefix}grants`);
  }

  /** Creates the indexes. */
  override async start(): Promise<void> {
    await this.sets.createIndex({ orgId: 1 });
    await this.grants.createIndex({ orgId: 1, subject: 1 });
    await this.grants.createIndex({ setId: 1 });
    await this.grants.createIndex({ folders: 1 });
  }

  override async grantsFor(
    orgId: string,
    principals: readonly string[],
  ): Promise<readonly GrantWithActions[]> {
    const rows = await this.grants
      .aggregate<{
        _id: string;
        effect: Effect;
        folders: string[];
        actions: string[];
        allActions: boolean;
      }>([
        { $match: { orgId, subject: { $in: [...principals] } } },
        {
          $lookup: {
            from: this.setsName,
            localField: 'setId',
            foreignField: '_id',
            as: 'set',
          },
        },
        { $unwind: '$set' },
        {
          $project: {
            effect: 1,
            folders: 1,
            actions: '$set.actions',
            allActions: '$set.allActions',
          },
        },
      ])
      .toArray();
    return rows.map(({ _id, ...row }) => ({ ...row, id: _id }));
  }

  override async getSet(id: string): Promise<PermissionSet | null> {
    const row = await this.sets.findOne({ _id: id });
    return row === null ? null : this.setMapper.fromModel(row as SetRow);
  }

  override async saveSet(set: PermissionSet): Promise<void> {
    const { _id, ...row } = this.setMapper.toModel(set);
    await this.sets.replaceOne({ _id }, row, { upsert: true });
    set.commit();
  }

  override async deleteSet(id: string): Promise<void> {
    await this.sets.deleteOne({ _id: id });
  }

  override async setInUse(id: string): Promise<boolean> {
    return (await this.grants.findOne({ setId: id })) !== null;
  }

  override async getGrant(id: string): Promise<Grant | null> {
    const row = await this.grants.findOne({ _id: id });
    return row === null ? null : this.grantMapper.fromModel(row as GrantRow);
  }

  override async saveGrant(grant: Grant): Promise<void> {
    const { _id, ...row } = this.grantMapper.toModel(grant);
    await this.grants.replaceOne({ _id }, row, { upsert: true });
    grant.commit();
  }

  override async deleteGrant(id: string): Promise<void> {
    await this.grants.deleteOne({ _id: id });
  }

  override async listGrants(query: GrantQuery): Promise<readonly Grant[]> {
    const rows = await this.grants
      .find({
        orgId: query.orgId,
        ...(query.subject !== undefined ? { subject: query.subject } : {}),
        ...(query.folder !== undefined ? { folders: query.folder } : {}),
      })
      .toArray();
    return rows.map((row) => this.grantMapper.fromModel(row as GrantRow));
  }
}
