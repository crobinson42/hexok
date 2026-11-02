# @hexok/authz

Access control for hexok applications. Install with `npm i @hexok/authz`. It depends only on `hexok`. MongoDB adapters are in `@hexok/authz-mongo`.

**Subjects must be product-stable ids, such as `user:sam`. Never store an identity provider's `sub`.** Grants name subjects. If they held the `sub`, changing providers would mean rewriting every grant. The gateway maps a provider identity to a subject. Authz does not know about identity providers, and it cannot detect this mistake.

## Terms

| Term | Meaning |
| --- | --- |
| Action | A verb the product defines, such as `note:edit`. Actions do not imply each other. |
| Catalog | The product's actions, declared in code. |
| Permission set | What can be done: a named list of actions. |
| Grant | Who gets a set, and where. It lists one or more folders. |
| Folder | Any record other records sit under. |
| Path | Where a record lives: its ancestor folders plus itself. |
| Actor | The resolved caller for one request. |
| Ceiling | The most an actor may do, whatever its grants say. |
| Filter | A serializable object a list repository turns into a query. |

## The rule

An actor may perform an action on a record when all of these hold:

1. The record's organization is in `actor.tenants`.
2. An allow grant applies and its set has the action. A grant applies when every folder it lists is in the record's path.
3. No deny grant that applies has the action.
4. If the actor has a ceiling, an entry has the action and applies the same way.
5. The action is in the catalog. A stored name a newer release removed is ignored.

The default is deny. A deny cannot be re-allowed further down the tree.

Domain rules are not authz. "Only drafts can be deleted" belongs to the entity. Authz answers whether this actor may delete here.

## Where data lives

One central database per product holds sets, grants, and every path. Each resource database holds a copy of the paths of its own records, next to those records. Grants are never copied, so revoking one takes effect on the next request everywhere. Resource documents hold no authz fields.

## Use it

Declare the catalog. `@hexok/authz/catalog` has no dependencies, so browsers and mobile clients can import it. Every catalog includes `access:manage`.

```ts
import { type AccessAction, AccessCatalog } from '@hexok/authz/catalog';

export class Therms extends AccessCatalog('therms', {
  actions: ['scan:read', 'note:read', 'note:edit'],
}) {}
export type Action = AccessAction<typeof Therms>;
```

Build `Authz` and `Paths` in the composition root. `principals` is your adapter of the `Principals` port. It reads memberships from your user data.

```ts
const authz = new Authz(
  { policies, paths: centralPaths, principals },
  { catalog: Therms },
);
const paths = new Paths({
  central: centralPaths,
  copies: { scans: scansPaths },
});
```

Keep paths current with one row per domain event. Subscribe the handlers like any other.

```ts
export const pathHandlers = paths.handlers([
  paths.placeOn(ScanRecorded, (s) => ({ id: s.id, parent: s.locationId }), 'scans'),
  paths.placeOn(ReportFiled, (r) => ({ id: r.id, parents: [r.locationId, r.typeId] }), 'scans'),
  paths.moveOn(LocationMoved, (l) => ({ id: l.id, parent: l.regionId })),
  paths.removeOn(ScanDeleted, (s) => s.id),
]);
```

Declare what each use case needs. Forgetting `authorize` or naming an unknown action is a compile error. `null` means the use case filters a list itself. `resource` cannot be typed against each use case's input, so a wrong selector compiles. An id with no path is refused.

```ts
const AppUseCase = UseCase.context<
  { authz: RequestAuthz<Action> },
  { authorize: Authorize<Action> }
>().guard(authorizeGuard);

class EditNote extends AppUseCase('note.edit', {
  authorize: { action: 'note:edit', resource: (i: { id: string }) => i.id },
}) {
  async execute(ctx: UseCase.Ctx<typeof AppUseCase>, input: { id: string; body: string }) {
    /* … */
  }
}

class ListNotes extends AppUseCase('note.list', { authorize: null }) {
  async execute({ authz }: UseCase.Ctx<typeof AppUseCase>) {
    const access = await authz.filter('note:read');
    return this.deps.notes.list({ access });
  }
}
```

A new record has no path yet, so authorize against its parent. A second check, such as a move's destination, calls `authz.require` in `execute`. Declare `execute` as a method. Assigning it as a class field skips the guard.

Resolve the actor once per request.

```ts
const actor = await authz.actor(subject, orgId);
const ctx = { authz: authz.forActor(actor) };
```

`actor` throws `NotAMember`, or `OrgRequired` when the subject has several organizations and none was named. `forActor` loads grants once, on first use.

## API

### RequestAuthz

| Member | Role |
| --- | --- |
| `actor` | The caller. |
| `allowed(ids)` | Each id's permitted actions. An unplaced id gets `[]`. |
| `can(action, id)` | One check. |
| `require(action, id)` | Throws `Forbidden { action }`. |
| `filter(action)` | The `AccessFilter` for a list repository. An empty `allow` means no access, and an adapter must return nothing. |
| `allowedAt(folders)` | The actions held where these folders meet: the union of their paths. An unplaced folder, or one in another organization, throws `NotFound { id }`. |
| `summary()` | Where each held action applies. |

### Paths

| Member | Role |
| --- | --- |
| `place(target, copy?)` | Writes central, then the named copy. A record already in central keeps its path, so a redelivered event cannot undo a move. |
| `move(target)` | Recomputes the subtree from each record's parents, then writes central and every copy. A retry gives the same result. |
| `remove(id)` | Removes the record and everything under it. |
| `placeOn`, `moveOn`, `removeOn` | Event handlers around the three above. |
| `handlers(list)` | The list the application subscribes. |

A place throws `ParentNotPlaced { id }` while a parent has no path, so a queue retries. `InvalidPath { id }` does not succeed on a retry. It means a parent in another organization, a move into the record's own subtree, or a move to no parent.

When a resource's `_id` is not the path id, such as an ObjectId, return `resourceId` from the `placeOn` mapper. The join uses it. Two records in one database cannot share a `resourceId`.

### Admin use cases

The context is `{ authz }`. The composition root builds them with `{ policies, catalog }` or `{ policies }`.

| Use case | Who may run it | Rules |
| --- | --- | --- |
| `CreatePermissionSet` | `access:manage` at the org root | Actions must be in the catalog. |
| `UpdatePermissionSet` | `access:manage` at the org root | Every added action must be held at the root. Takes effect for every grant using the set. An Owner set throws `ProtectedSet`. |
| `DeletePermissionSet` | `access:manage` at the org root | Throws `InUse` while a grant uses it. |
| `GrantAccess` | `access:manage` where the folders meet | Every action in the set must be held there, for an allow or a deny. |
| `RevokeGrant` | `access:manage` where the folders meet. A deny takes it at the org root. | A manager cannot lift a deny that binds them. A root manager can revoke a grant on a removed folder. |
| `ListGrants` | `access:manage` at the queried folder, or the root when none is named | |
| `BootstrapOrganization` | Internal. Called by onboarding, with no actor. | Places the org root and grants the founder an Owner set. Owner sets follow the catalog, so they gain actions a later release adds. A repeat is safe. |

A set or grant in another organization throws `NotFound { id }`.

`GetAllowedActions` takes up to 100 ids. `GetAccessSummary` returns `summary()`. Expose them through your own contract.

### Errors

`AuthzError` is a catalog. The status is a suggestion for the gateway.

| Error | Data | Status |
| --- | --- | --- |
| `NotAMember` | | 403 |
| `OrgRequired` | | 400 |
| `NotFound` | `{ id }` | 404 |
| `Forbidden` | `{ action }` | 403 |
| `Escalation` | `{ missing }` | 403 |
| `UnknownAction` | `{ actions }` | 400 |
| `InUse` | | 409 |
| `ProtectedSet` | | 403 |
| `ParentNotPlaced` | `{ id }` | Internal. The queue retries. |
| `InvalidPath` | `{ id }` | Internal. A retry does not help. |

### Ports

`Principals` is implemented by the product. `PolicyStore` and `PathStore` are implemented by an adapter package. `MemoryPolicyStore`, `MemoryPathStore`, and `memoryFilter` are for tests. Adapter classes are closed. Wrap one in your own adapter of the port when you need extra logic.

## Clients

Clients display and never enforce. The server checks every request.

Values arrive as strings. Run them through `Catalog.parse`, which drops unknown names, so a newer server cannot break an older client. Between services, pass who is acting, not a list of permissions.

## What it leaves to the application

- Authentication, sessions, and mapping an identity to a subject.
- Memberships and groups.
- Record status and other domain rules.
- Subscribing handlers, and retries.

## Known limits

- **A new record is missing from lists until its handler runs.** To close the gap, a create use case can also call `paths.place`, which is safe to repeat.
- **Paths can drift.** A record placed while its parent is moving can get a stale path. A place event redelivered after a remove recreates the path. Moves and removes are rare, and handlers are safe to repeat. The package does not repair drift yet.
- **A move costs one write per descendant.**
- **Grant by folder, not by record.** Each applicable grant adds an entry to the filter, so thousands of hand-picked records make every list query slower.
- **An admin can lock everyone out.** A root manager can deny `access:manage` at the org root. The package does not prevent it. Recovery means editing the database.
- **Actor `tenants` holds one organization.** Cross-tenant sharing is not built. API keys are not built. The actor's ceiling is the seam they will use.
