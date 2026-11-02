import { randomUUID } from 'node:crypto';
import { UseCase, validationError } from 'hexok';
import type { RequestAuthz } from './authz.js';
import { MANAGE } from './catalog.js';
import {
  Grant,
  type GrantProps,
  PermissionSet,
  type PermissionSetProps,
} from './entities.js';
import { AuthzError } from './errors.js';
import type { AccessSummary, Effect } from './model.js';
import type { Placement } from './paths.js';
import type { PolicyStore } from './ports.js';

/**
 * What a use case needs. `null` means it filters the list itself. `resource`
 * cannot be typed against each use case's input, so a wrong selector compiles.
 * An id with no path is refused.
 */
export type Authorize<A extends string> = {
  readonly action: A;
  readonly resource: (input: never) => string;
} | null;

/** Pass to `UseCase.context().guard()`. Reads `spec.authorize` on each call. */
export async function authorizeGuard<A extends string>(call: {
  readonly ctx: { readonly authz: RequestAuthz<A> };
  readonly spec: { readonly authorize: Authorize<A> };
  readonly input: unknown;
}): Promise<void> {
  const { authorize } = call.spec;
  if (authorize === null) return;
  await call.ctx.authz.require(
    authorize.action,
    authorize.resource(call.input as never),
  );
}

export type AuthzCtx = { readonly authz: RequestAuthz };

/** The family of admin and read use cases. Each one checks access in `execute`. */
export const AuthzUseCase = UseCase.context<AuthzCtx>();

/** The part of a catalog the admin use cases read. */
export type CatalogRef = {
  readonly actions: readonly string[];
  unknown(list: readonly string[]): string[];
};

type Admin = {
  policies: PolicyStore;
  catalog: CatalogRef;
};

function assertKnown(catalog: CatalogRef, actions: readonly string[]): void {
  const unknown = catalog.unknown(actions);
  if (unknown.length > 0) throw AuthzError.UnknownAction({ actions: unknown });
}

function assertHeld(held: readonly string[], actions: readonly string[]): void {
  const missing = actions.filter((action) => !held.includes(action));
  if (missing.length > 0) throw AuthzError.Escalation({ missing });
}

async function requireManageAt(
  authz: RequestAuthz,
  folders: readonly string[],
): Promise<readonly string[]> {
  const held = await authz.allowedAt(folders);
  if (!held.includes(MANAGE)) throw AuthzError.Forbidden({ action: MANAGE });
  return held;
}

/** Loads a set in the actor's organization. Another organization's set is not found. */
async function loadSet(
  policies: PolicyStore,
  authz: RequestAuthz,
  id: string,
): Promise<PermissionSet> {
  const set = await policies.getSet(id);
  if (set === null || set.props.orgId !== authz.actor.orgId) {
    throw AuthzError.NotFound({ id });
  }
  return set;
}

export class CreatePermissionSet extends AuthzUseCase('authz.set.create') {
  constructor(private readonly deps: Admin) {
    super();
  }

  async execute(
    { authz }: AuthzCtx,
    input: { readonly name: string; readonly actions: readonly string[] },
  ): Promise<PermissionSetProps> {
    const { orgId, id: actorId } = authz.actor;
    await authz.require(MANAGE, orgId);
    assertKnown(this.deps.catalog, input.actions);
    const now = new Date();
    const set = PermissionSet.create({
      id: `set:${randomUUID()}`,
      orgId,
      name: input.name,
      actions: [...input.actions],
      allActions: false,
      createdBy: actorId,
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.policies.saveSet(set);
    return set.toProps() as PermissionSetProps;
  }
}

export class UpdatePermissionSet extends AuthzUseCase('authz.set.update') {
  constructor(private readonly deps: Admin) {
    super();
  }

  /** Takes effect for every grant using the set. Added actions must be held at the root. */
  async execute(
    { authz }: AuthzCtx,
    input: {
      readonly id: string;
      readonly name?: string;
      readonly actions?: readonly string[];
    },
  ): Promise<PermissionSetProps> {
    const { orgId } = authz.actor;
    await authz.require(MANAGE, orgId);
    const set = await loadSet(this.deps.policies, authz, input.id);
    if (set.props.allActions) throw AuthzError.ProtectedSet();
    if (input.actions !== undefined) {
      assertKnown(this.deps.catalog, input.actions);
      const added = input.actions.filter(
        (action) => !set.props.actions.includes(action),
      );
      assertHeld(await authz.allowedAt([orgId]), added);
    }
    set.change(
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.actions !== undefined ? { actions: input.actions } : {}),
      },
      new Date(),
    );
    await this.deps.policies.saveSet(set);
    return set.toProps() as PermissionSetProps;
  }
}

export class DeletePermissionSet extends AuthzUseCase('authz.set.delete') {
  constructor(private readonly deps: { policies: PolicyStore }) {
    super();
  }

  async execute(
    { authz }: AuthzCtx,
    input: { readonly id: string },
  ): Promise<void> {
    await authz.require(MANAGE, authz.actor.orgId);
    await loadSet(this.deps.policies, authz, input.id);
    if (await this.deps.policies.setInUse(input.id)) throw AuthzError.InUse();
    await this.deps.policies.deleteSet(input.id);
  }
}

export class GrantAccess extends AuthzUseCase('authz.grant.create') {
  constructor(private readonly deps: Admin) {
    super();
  }

  /** The actor must hold `access:manage` and every action of the set where the folders meet. */
  async execute(
    { authz }: AuthzCtx,
    input: {
      readonly subject: string;
      readonly setId: string;
      readonly folders: readonly string[];
      readonly effect?: Effect;
    },
  ): Promise<GrantProps> {
    const { catalog, policies } = this.deps;
    const held = await requireManageAt(authz, input.folders);
    const set = await loadSet(policies, authz, input.setId);
    const given = set.props.allActions
      ? catalog.actions
      : set.props.actions.filter((action) => catalog.actions.includes(action));
    assertHeld(held, given);
    const grant = Grant.create({
      id: `grant:${randomUUID()}`,
      orgId: authz.actor.orgId,
      subject: input.subject,
      setId: input.setId,
      folders: [...input.folders],
      effect: input.effect ?? 'allow',
      createdBy: authz.actor.id,
      createdAt: new Date(),
    });
    await policies.saveGrant(grant);
    return grant.toProps() as GrantProps;
  }
}

export class RevokeGrant extends AuthzUseCase('authz.grant.revoke') {
  constructor(private readonly deps: { policies: PolicyStore }) {
    super();
  }

  /**
   * An allow takes `access:manage` where its folders meet. A deny takes it at
   * the org root, so a manager cannot lift a deny that binds them. A root
   * manager can also revoke a grant whose folder no longer exists.
   */
  async execute(
    { authz }: AuthzCtx,
    input: { readonly id: string },
  ): Promise<void> {
    const { policies } = this.deps;
    const grant = await policies.getGrant(input.id);
    if (grant === null || grant.props.orgId !== authz.actor.orgId) {
      throw AuthzError.NotFound({ id: input.id });
    }
    if (!(await authz.can(MANAGE, authz.actor.orgId))) {
      if (grant.props.effect === 'deny') {
        throw AuthzError.Forbidden({ action: MANAGE });
      }
      await requireManageAt(authz, grant.props.folders);
    }
    await policies.deleteGrant(input.id);
  }
}

export class ListGrants extends AuthzUseCase('authz.grant.list') {
  constructor(private readonly deps: { policies: PolicyStore }) {
    super();
  }

  /** Without a folder, this reads the whole organization and takes `access:manage` at the root. */
  async execute(
    { authz }: AuthzCtx,
    input: { readonly folder?: string; readonly subject?: string },
  ): Promise<readonly GrantProps[]> {
    const { orgId } = authz.actor;
    await requireManageAt(authz, [input.folder ?? orgId]);
    const grants = await this.deps.policies.listGrants({
      orgId,
      ...(input.folder !== undefined ? { folder: input.folder } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
    });
    return grants.map((grant) => grant.toProps() as GrantProps);
  }
}

/**
 * Internal. Onboarding calls it, so no actor exists yet. Gives the founder an
 * Owner set that follows the catalog. A repeat is safe.
 */
export class BootstrapOrganization extends UseCase(
  'authz.organization.bootstrap',
) {
  constructor(
    private readonly deps: {
      policies: PolicyStore;
      paths: { place(target: Placement): Promise<void> };
    },
  ) {
    super();
  }

  async execute(input: {
    readonly orgId: string;
    readonly founder: string;
  }): Promise<{ readonly setId: string; readonly grantId: string }> {
    const { policies, paths } = this.deps;
    const { orgId, founder } = input;
    const setId = `set:owner:${orgId}`;
    const grantId = `grant:owner:${orgId}`;
    await paths.place({ id: orgId });
    const now = new Date();
    if ((await policies.getSet(setId)) === null) {
      await policies.saveSet(
        PermissionSet.create({
          id: setId,
          orgId,
          name: 'Owner',
          actions: [],
          allActions: true,
          createdBy: founder,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    if ((await policies.getGrant(grantId)) === null) {
      await policies.saveGrant(
        Grant.create({
          id: grantId,
          orgId,
          subject: founder,
          setId,
          folders: [orgId],
          effect: 'allow',
          createdBy: founder,
          createdAt: now,
        }),
      );
    }
    return { setId, grantId };
  }
}

const MAX_IDS = 100;

export class GetAllowedActions extends AuthzUseCase('authz.allowed.get') {
  async execute(
    { authz }: AuthzCtx,
    input: { readonly ids: readonly string[] },
  ): Promise<Readonly<Record<string, readonly string[]>>> {
    if (input.ids.length > MAX_IDS) {
      throw validationError(`authz.allowed.get takes up to ${MAX_IDS} ids`);
    }
    return authz.allowed(input.ids);
  }
}

export class GetAccessSummary extends AuthzUseCase('authz.summary.get') {
  async execute({ authz }: AuthzCtx): Promise<AccessSummary> {
    return authz.summary();
  }
}
