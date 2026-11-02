export type Effect = 'allow' | 'deny';

export type Permission = {
  readonly actions: readonly string[];
  readonly folders: readonly string[];
};

export type Actor = {
  /** Product-stable subject, such as `user:sam`. Never the IdP's `sub`. */
  readonly id: string;
  /** Set when acting through an API key. */
  readonly key?: string;
  readonly orgId: string;
  /** `[orgId]` in the MVP. */
  readonly tenants: readonly string[];
  /** The subject plus its groups. */
  readonly principals: readonly string[];
  /** The most this actor may do, whatever its grants say. */
  readonly ceiling?: readonly Permission[];
};

/** Serializable on purpose. A repository turns it into a query. */
export type AccessFilter = {
  readonly orgIds: readonly string[];
  /** The path must contain all folders of at least one entry. Empty means no access. */
  readonly allow: readonly (readonly string[])[];
  /** The path must not contain all folders of any entry. */
  readonly deny: readonly (readonly string[])[];
  /** Ceiling. The path must contain all folders of at least one entry. */
  readonly within?: readonly (readonly string[])[];
};

/** Where each action applies. Clients use it to display, never to enforce. */
export type AccessSummary<A extends string = string> = {
  readonly actor: { readonly id: string; readonly orgId: string };
  readonly actions: Partial<
    Record<A, Pick<AccessFilter, 'allow' | 'deny' | 'within'>>
  >;
};

/** A grant joined with its set, as a store returns it. */
export type GrantWithActions = {
  readonly id: string;
  readonly effect: Effect;
  readonly folders: readonly string[];
  readonly actions: readonly string[];
  /** The set follows the catalog. `actions` is not used. */
  readonly allActions: boolean;
};

/** The part of a path document that decides access. */
export type Located = {
  readonly orgId: string;
  readonly path: readonly string[];
};

/**
 * Applies the catalog to stored grants. `allActions` becomes the current
 * catalog. Names a newer release removed are dropped.
 */
export function resolveGrants(
  grants: readonly GrantWithActions[],
  catalog: readonly string[],
): readonly GrantWithActions[] {
  return grants.map((grant) => ({
    ...grant,
    actions: grant.allActions
      ? catalog
      : grant.actions.filter((action) => catalog.includes(action)),
  }));
}

/** The filter for one action. Pass grants from {@link resolveGrants}. */
export function buildFilter(
  action: string,
  actor: Actor,
  grants: readonly GrantWithActions[],
): AccessFilter {
  const foldersOf = (effect: Effect) =>
    grants
      .filter(
        (grant) =>
          grant.effect === effect &&
          grant.actions.includes(action) &&
          grant.folders.length > 0,
      )
      .map((grant) => grant.folders);
  const within = actor.ceiling
    ?.filter(
      (entry) => entry.actions.includes(action) && entry.folders.length > 0,
    )
    .map((entry) => entry.folders);
  return {
    orgIds: actor.tenants,
    // A ceiling with no entry for this action leaves nothing to allow.
    allow: within?.length === 0 ? [] : foldersOf('allow'),
    deny: foldersOf('deny'),
    ...(within !== undefined ? { within } : {}),
  };
}

/** True when `filter` admits a record at this location. */
export function matches(filter: AccessFilter, record: Located): boolean {
  const contains = (folders: readonly string[]) =>
    folders.length > 0 &&
    folders.every((folder) => record.path.includes(folder));
  return (
    filter.orgIds.includes(record.orgId) &&
    filter.allow.some(contains) &&
    !filter.deny.some(contains) &&
    (filter.within === undefined || filter.within.some(contains))
  );
}

/** The rule that decides access. Pass grants from {@link resolveGrants}. */
export function evaluate(
  action: string,
  record: Located,
  actor: Actor,
  grants: readonly GrantWithActions[],
): boolean {
  return matches(buildFilter(action, actor, grants), record);
}

/** The union of several paths, without repeats, in first-seen order. */
export function unionPaths(
  paths: readonly (readonly string[])[],
): readonly string[] {
  return [...new Set(paths.flat())];
}
