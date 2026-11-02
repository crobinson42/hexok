import { AuthzError } from './errors.js';
import {
  type AccessFilter,
  type AccessSummary,
  type Actor,
  buildFilter,
  evaluate,
  type GrantWithActions,
  type Located,
  resolveGrants,
  unionPaths,
} from './model.js';
import type { PathStore, PolicyStore, Principals } from './ports.js';

/** One actor's view of access, for one request. It caches the actor's grants. */
export type RequestAuthz<A extends string = string> = {
  readonly actor: Actor;
  /** Each id's permitted actions. An unplaced id gets `[]`. */
  allowed(
    ids: readonly string[],
  ): Promise<Readonly<Record<string, readonly A[]>>>;
  can(action: A, id: string): Promise<boolean>;
  /** Throws `AuthzError.Forbidden` when the actor may not. */
  require(action: A, id: string): Promise<void>;
  /** Hand it to a list repository. */
  filter(action: A): Promise<AccessFilter>;
  /**
   * The actions held where these folders meet: the union of their paths.
   * An unplaced folder, or one in another organization, throws `NotFound`.
   */
  allowedAt(folders: readonly string[]): Promise<readonly A[]>;
  /** Where each action applies. For clients. */
  summary(): Promise<AccessSummary<A>>;
};

/** Resolves callers and builds their per-request view. */
export class Authz<A extends string> {
  constructor(
    private readonly deps: {
      policies: PolicyStore;
      paths: PathStore;
      principals: Principals;
    },
    private readonly config: { catalog: { readonly actions: readonly A[] } },
  ) {}

  /** Throws `NotAMember`, or `OrgRequired` when several match and none was named. */
  async actor(subject: string, orgId?: string): Promise<Actor> {
    const memberships = await this.deps.principals.memberships(subject, orgId);
    if (orgId === undefined && memberships.length > 1) {
      throw AuthzError.OrgRequired();
    }
    const membership =
      orgId === undefined
        ? memberships[0]
        : memberships.find((candidate) => candidate.orgId === orgId);
    if (membership === undefined) throw AuthzError.NotAMember();
    return {
      id: subject,
      orgId: membership.orgId,
      tenants: [membership.orgId],
      principals: [subject, ...membership.groups],
    };
  }

  /** Build one per request. Grants load once, on first use. */
  forActor<B extends A = A>(actor: Actor): RequestAuthz<B> {
    const { policies, paths } = this.deps;
    const catalog = this.config.catalog.actions as readonly B[];

    let loaded: Promise<readonly GrantWithActions[]> | undefined;
    const grants = () => {
      loaded ??= policies
        .grantsFor(actor.orgId, actor.principals)
        .then((rows) => resolveGrants(rows, catalog));
      return loaded;
    };
    const actionsAt = async (record: Located) => {
      const rows = await grants();
      return catalog.filter((action) => evaluate(action, record, actor, rows));
    };

    const view: RequestAuthz<B> = {
      actor,
      async allowed(ids) {
        const docs = await paths.get(ids);
        const result: Record<string, readonly B[]> = {};
        for (const id of ids) result[id] = [];
        for (const doc of docs) result[doc.id] = await actionsAt(doc);
        return result;
      },
      async can(action, id) {
        const [doc] = await paths.get([id]);
        if (doc === undefined) return false;
        return evaluate(action, doc, actor, await grants());
      },
      async require(action, id) {
        if (!(await view.can(action, id))) {
          throw AuthzError.Forbidden({ action });
        }
      },
      async filter(action) {
        return buildFilter(action, actor, await grants());
      },
      async allowedAt(folders) {
        const docs = await paths.get(folders);
        for (const id of folders) {
          const doc = docs.find((candidate) => candidate.id === id);
          if (doc === undefined || !actor.tenants.includes(doc.orgId)) {
            throw AuthzError.NotFound({ id });
          }
        }
        return actionsAt({
          orgId: actor.orgId,
          path: unionPaths(docs.map((doc) => doc.path)),
        });
      },
      async summary() {
        const rows = await grants();
        const actions: AccessSummary<B>['actions'] = {};
        for (const action of catalog) {
          const { allow, deny, within } = buildFilter(action, actor, rows);
          if (allow.length === 0) continue;
          actions[action] = {
            allow,
            deny,
            ...(within !== undefined ? { within } : {}),
          };
        }
        return { actor: { id: actor.id, orgId: actor.orgId }, actions };
      },
    };
    return view;
  }
}
