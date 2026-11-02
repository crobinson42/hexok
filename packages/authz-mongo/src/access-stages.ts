import type { AccessFilter } from '@hexok/authz';
import type { Document } from 'mongodb';

/**
 * Stages for a list repository's pipeline. Narrow with the repository's own
 * indexes first, because each row left costs one lookup into the path copy.
 * A record with no path yet is left out.
 */
export function accessStages(
  filter: AccessFilter,
  options: { readonly prefix?: string } = {},
): Document[] {
  if (filter.allow.length === 0 || filter.within?.length === 0) {
    return [{ $match: { $expr: false } }];
  }
  const has = (folders: readonly string[]) => ({
    '_authz.path': { $all: folders },
  });
  return [
    {
      $lookup: {
        from: `${options.prefix ?? 'authz_'}paths`,
        localField: '_id',
        foreignField: 'resourceId',
        as: '_authz',
      },
    },
    { $unwind: '$_authz' },
    {
      $match: {
        '_authz.orgId': { $in: filter.orgIds },
        $and: [
          { $or: filter.allow.map(has) },
          ...(filter.within !== undefined
            ? [{ $or: filter.within.map(has) }]
            : []),
        ],
        // Mongo rejects an empty $nor.
        ...(filter.deny.length > 0 ? { $nor: filter.deny.map(has) } : {}),
      },
    },
    { $project: { _authz: 0 } },
  ];
}
