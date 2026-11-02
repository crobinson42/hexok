# Authz example

An HTTP API for a small site, built in the same layout as `examples/app-template`. Organizations contain regions and locations. Locations contain scans. Scans contain notes. Use cases call `@hexok/authz` before they read or change a record. Records stay in memory. The process has no worker and no Redis.

## Run

From the repository root:

```bash
npx turbo run build --filter=@hexok/authz-example
npm run start --workspace=@hexok/authz-example
```

The server listens on port 3000. `PORT` changes it. Restarting the process clears the records and the tuples. The process stops on `SIGINT` or `SIGTERM`.

Every call is `POST /rpc/<procedure>` with the body `{"input": …}`. A success is `{"ok": true, "output": …}`. Send the actor in the `x-actor` header. `alice` is `user:alice`. `group:night-crew` is that group. The header stands in for the product gateway. The authz package does not read it.

```bash
curl -s -H 'x-actor: alice' -H 'content-type: application/json' \
  -d '{"input":{}}' \
  http://127.0.0.1:3000/rpc/scans/list
```

Alice sees scans 91 and 92. She can view the west region through the night crew. She cannot edit those scans.

## Layout

Source is split by layer. Use cases stay grouped by feature and by who calls them:

```
src/domain/     schemas, entities, and errors
src/app/        the catalog, ports, and use cases
src/infra/      in-memory repositories
src/servers/    composition root and HTTP

src/servers/
  composition.ts   Authz, MemoryTupleStore, repositories, and the seed
  api.ts           createApi(ports): the API use cases
  seed.ts          the sample company
  rpc/contract.ts  apiContract
  rpc/app.ts       one handler per procedure, and the x-actor header
  http/handler.ts  createHttpHandler: /rpc as one fetch function
  http/main.ts     HTTP process entry

src/app/use-cases/
  context.ts                      ApiUseCase. The context is { actor }.
  scans/api/query/                list, get
  scans/api/command/              create, update
  notes/api/query/                list, get
  notes/api/command/              create
  locations/api/query/            list, get
  locations/api/command/          create
  regions/api/command/            create
  groups/api/query/               list, get
  groups/api/command/             create, add member, remove member
  shares/api/command/             grant, revoke
  access/api/query/               explain
```

`src/app/authz/catalog.ts` is the only policy. A repository stores an id, a name, and the parent id the product needs. It does not import `@hexok/authz`.

A list asks authz for ids, then loads those records:

```ts
const ids = await this.deps.authz.list({
  actor: ctx.actor,
  action: 'scan:view',
  type: 'scan',
});
return this.deps.scans.listByIds(ids);
```

A single record asks `check` first. A failed check is `403`, including an id the repository has never stored. When the check passes and the row is gone, the response is `404`.

Creating a scan stores the row, then writes one parent tuple:

```ts
await this.deps.authz.write({
  object: `scan:${scan.props.id}`,
  relation: 'parent',
  subject: `location:${scan.props.locationId}`,
});
```

The location id on the scan is the product fact. The parent tuple is the authorization fact.

## Sample company

`ada` is an editor of both organizations and of the night crew. `dave` is a member of Acme. A member tuple grants nothing by itself, so Dave's scan list is empty. `helen` is a viewer of Acme, so she can view every scan under it. `gina` is a viewer of scan 7, which lives under the other organization. That share is the same shape of tuple as any other viewer.

| Header | View |
| --- | --- |
| `alice` | Scans 91 and 92, through `group:night-crew` on region west. |
| `erin` | The same scans. Day crew is a member of night crew. |
| `group:night-crew` | The same scans. The group matches the viewer tuple directly. |
| `dave` | Nothing. Membership of Acme is not `scan:view`. |
| `helen` | Every Acme scan. Scan 7 stays hidden. |
| `bob` | Scan 92. He is an editor, so he can change the title. |
| `carol` | Scan 93. She is an editor of region east. |
| `contractor` | Scan 91 and note 5. Viewer of location gate A. |
| `frank` | Scan 93. The east viewer tuple names `group:auditors#member`. |
| `gina` | Scan 7 only. |
| `ada` | Every seeded scan. |

`POST /rpc/access/explain` with `{"input":{"action":"scan:view","id":"91"}}` and `x-actor: alice` returns the tuples on the granting path. An unknown action fails validation.

## Shares and members

A share is a `viewer` or `editor` tuple. The caller has to pass the edit check on that resource. Carol can share scan 93 with someone who has no other relationship:

```bash
curl -s -H 'x-actor: carol' -H 'content-type: application/json' \
  -d '{"input":{"type":"scan","id":"93","relation":"viewer","subject":"user:outsider"}}' \
  http://127.0.0.1:3000/rpc/shares/grant
```

`POST /rpc/shares/revoke` with the same input removes that tuple. Writing the same tuple twice stores it once. `parent` is not a share relation.

A member is a `member` tuple. `POST /rpc/groups/create` makes the actor the group's editor. `POST /rpc/groups/addMember` with `{"input":{"id":"weekend","subject":"user:noah"}}` adds a member. The group record stays `{ id, name }`.

## Errors

| Error | Status |
| --- | --- |
| `BAD_REQUEST` | 400 |
| `Authz`: a ref or actor type the catalog rejects | 400 |
| `ActorInvalid`, `ShareRelationInvalid`, `SubjectInvalid`, `MemberInvalid` | 400 |
| `ActorRequired`: no `x-actor` header | 401 |
| `Forbidden`: the check failed, including an unknown id | 403 |
| `NotFound`: the check passed and the row is gone, or a parent record is missing on create | 404 |
| `AlreadyExists` | 409 |
| `VALIDATION` | 422 |

## Add a type

`note` is the pattern.

1. Add the object and its permissions in `src/app/authz/catalog.ts`.
2. Add the schema and entity under `src/domain/`, and a repository port under `src/app/ports/repos/`.
3. On create, check edit on the parent, save the record, and write a `parent` tuple. `CreateNote` does those three steps.
4. On read, call `note:view`. Add the procedure to `apiContract` and one handler in `createApiApp`.

`check` and `list` then accept `'note:view'` and `'note:edit'`. An unknown action is a compile error in `ExplainAccess` and a validation error from `POST /rpc/access/explain`.
