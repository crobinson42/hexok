# Authz example

A product on three databases: `authz` (central), `places` (locations), and `scans` (scans and notes). Two `MongoClient` connections serve them, so nothing can join across databases.

The product touches authz in five files:

| File | What it does |
| --- | --- |
| `src/access.ts` | Declares the catalog. |
| `src/composition.ts` | Builds `Authz` and `Paths`. |
| `src/path-handlers.ts` | One row per domain event. |
| `src/use-cases.ts` | Each use case declares `authorize`. |
| `src/repositories.ts` | List queries append `accessStages`. |

Scans use ObjectId `_id`s and notes use string `_id`s. The path handler passes the ObjectId as `resourceId`.

`src/scenario.integration.test.ts` runs the reference scenario. Events are delivered in process, and the publisher awaits each handler, so each step sees the last one's paths.

```bash
docker run --rm -p 27017:27017 mongo:7
MONGO_URL=mongodb://127.0.0.1:27017 npm run test --workspace=@hexok/authz-example
```
