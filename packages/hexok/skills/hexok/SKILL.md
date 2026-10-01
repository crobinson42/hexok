---
name: hexok
description: >
  Build application features with the hexok primitives. Use when the task adds
  or changes a user story, entity, schema, use case, port, adapter, event,
  event handler, gateway, or background worker in a project that depends on
  hexok. Follow its thought, research, and plan steps, and read the primitive
  reference it names before writing that primitive.
license: MIT
metadata:
  short-description: Build features with hexok
---

# Hexok

Import primitives from `hexok`. The application owns HTTP, RPC, websockets, gRPC, the object graph, brokers, ack, retry, and consumer groups.

The running shape is a person who creates a blog post and publishes it. Subscribers are emailed afterward. Use the application's real story. The blog is only the shape.

## Concepts

Read the reference before writing that concept. Each file is the supporting documentation for one primitive.

| Concept | Reference | Place |
| --- | --- | --- |
| Schema | [references/schema.md](references/schema.md) | Domain. The shape of stored data and event payloads. |
| Entity | [references/entity.md](references/entity.md) | Domain. One stored thing and its rules. |
| Error | [references/error.md](references/error.md) | Domain. Named refusals, the error map, and `CodedError` `VALIDATION`. |
| Event | [references/event.md](references/event.md) | Domain. A fact the use case records. |
| EventCatalog | [references/event-catalog.md](references/event-catalog.md) | Domain. The set of events, and the conversion to a wire message. |
| UseCase | [references/use-case.md](references/use-case.md) | Application. One caller action. `UseCase.context` is in that file. |
| Port | [references/port.md](references/port.md) | Application. The contract a use case or handler calls. |
| EventHandler | [references/event-handler.md](references/event-handler.md) | Application. Work that follows one event. |
| Adapter | [references/adapter.md](references/adapter.md) | Interface adapter. The current implementation of one port. |
| Mapper | [references/mapper.md](references/mapper.md) | Interface adapter. Read it when the stored document is not the domain props. |

Dependencies point inward. Domain code does not import a database client, a queue, an HTTP library, or a mail SDK. Use cases and handlers depend on ports. Adapters implement ports. A gateway calls use cases.

## How to build a feature

Walk the steps below three times, in this order, before you edit files.

1. **Thought.** State one user story: who acts, and what they can do. Example: as a user I can create a blog post and publish it. Name the actions a caller can invoke on their own. Creating a draft and publishing it are two use cases when both are reachable. One use case is enough when the caller can only publish.
2. **Research.** Search the codebase for that story. Note the entity, schema, error catalog, use case, ports, events, handlers, adapters, gateway route, and worker entry that already exist.
3. **Plan.** Write a short plan in the step order below. Mark each item `exists` or `add`. A step with nothing to add is `none`. Then implement in that same order.

When the task is only a plan, stop after the plan. When the task is to build the feature, implement the plan after it is written. Read the matching reference at the start of each step you implement.

### 1. User story

Write the story in one sentence. That sentence is the feature. Later files, tokens, and routes should be recognizable as parts of it.

### 2. Entities and schemas

Identify what the story persists. Define the schema, then the entity, when they are not already there.

A blog post is an id, a title, a body, and whether it is published. The schema is that shape. The entity holds the rules, such as refusing a blank title or a second publish. Read [references/schema.md](references/schema.md) and [references/entity.md](references/entity.md). Add catalog members used by those rules while you are here. Read [references/error.md](references/error.md).

### 3. Use cases and ports

Define each use case as one action, and the ports that action calls, when they are not already there.

Saving a post is a port. Publishing an event is a different port. The use case receives both in its constructor and calls them from `execute`. It does not import a driver. Read [references/use-case.md](references/use-case.md) and [references/port.md](references/port.md).

Use `UseCase(token)` when `execute` only needs the input. Use `UseCase.context<Ctx>()` when every call in the family carries the same extra facts, such as a trace id, the actor, or the caller IP. Share one family across the gateway's use cases.

### 3.b. Side effects

Identify work that is a consequence of the story and is outside the use case's job. Emailing subscribers after a post is published is that kind of work. Indexing and heavy computation are too.

When that work exists and the event does not, define the event and register it on a catalog. Give the use case an event-publisher port and publish the event instance at the end of `execute`, after the entity rule has run and the save has succeeded. Read [references/event.md](references/event.md) and [references/event-catalog.md](references/event-catalog.md).

When the story has no consequence beyond its own write, this step is `none`. Do not add an event so the step looks complete.

### 3.c. Event handlers

When step 3.b named a side effect, implement the handler if it does not exist. The handler takes its own ports in the constructor. `handle` receives the event. Emailing subscribers loads addresses through a subscriber port and sends mail through a mail port. Read [references/event-handler.md](references/event-handler.md).

The handler does not subscribe itself. Subscription belongs to the adapter in step 4.

### 4. Adapters

List every port a use case or handler calls, including repositories, the event publisher, the event subscription, and outbound ports such as email. Implement each missing port as an adapter.

An adapter is the concrete port: memory while sketching, a database in the API, a fake in a test, a broker when a worker runs elsewhere. Swapping it changes the composition root. `execute` stays put. Read [references/adapter.md](references/adapter.md).

Read [references/mapper.md](references/mapper.md) when the stored document is a different shape from the domain props. Persisting `toProps()` as JSON needs no mapper.

The publisher adapter accepts `EventInstance<typeof Catalog>`. It sends `Catalog.message(event)` when the transport stores bytes. The subscription adapter runs `Catalog.parse` and then `handle`. Ack, retry, prefetch, and consumer groups stay on that adapter.

### 5. Gateway

Identify how a caller outside the process reaches the use case. The common surface is HTTP in an RPC shape: one path per use case, such as `POST /posts` and `POST /posts/:id/publish`. REST, websockets, and gRPC are the same kind of edge when the story needs them.

Use the HTTP library the application already depends on. Express, Hono, and Koa are all suitable. Add one only when the application has none.

The route builds the call context, calls `execute`, and maps failures to the reply. A missing entity is a 404. `CodedError` code `VALIDATION` is a 400 and `data.issues` names the fields. A catalog conflict, such as an already published post, is a 409. The catalog does not contain status codes.

Construct adapters, call `start`, and construct use cases in the entry point. A use case instance is long-lived. Context is an argument to `execute`, not a field set per request.

### 6. Where handlers run

Skip this step when there is no handler.

Decide whether each handler shares the API process. Share it when the work is small, or when no adapter can publish in one process and subscribe in another.

Add a background-worker entry point when the handler does heavy work and a distributed publish/subscribe adapter exists. The API entry publishes. The worker entry starts the subscription adapter, registers the handlers, and runs them. The two processes use the same catalog. The worker parses the wire message, then calls `handle`.

Do not add a broker only to create a second process. Do not move the handler's work back into `execute`.

## Conventions

- Tokens are factory arguments: `Entity('Post', PostSchema)`, `UseCase('post.publish')`, `Port('PostRepository')`, `Event('post.published', PostSchema)`, `EventCatalog('blog', { postPublished })`, `EventHandler('email.subscribers', PostPublished)`, `Errors('blog', { ... })`. A subclass does not redeclare the token.
- `execute`, `handle`, port methods, and a mapper's `fromSource` and `toSource` are methods on the class. The compiler reports a missing one. `start`, `stop`, `parse`, and `set` already exist and may be overridden.
- A use case throws a catalog member when the story refuses. Schema checks throw `CodedError` with code `VALIDATION`. Catch both at the gateway or the worker.
- Call catalog factories without `new`: `BlogError.BlankTitle()`.
- Check use-case input in a guard or in the first lines of `execute`. A schema stored on a `UseCase.context` static bag is application data. Hexok does not run it.
- Annotate `execute` on the subclass. Callers see that annotation. On a context family, the parameters are `(ctx, input)` and `ctx` is `UseCase.Ctx<typeof Factory>`.
- Publish `new PostPublished(payload)`. Compare events with `instanceof` or `event.token`. The catalog map key (`postPublished`) and the event token (`post.published`) are different strings.
- After a successful driver write, the adapter calls `commit()` on the entity. The mapper does not commit.
- Tests construct the use case with adapters of the same ports. A test of the story does not need a live broker.
- Put one concept in one file. A practical layout is `schemas/`, `entities/`, `errors/`, `events/`, `ports/`, `use-cases/`, `handlers/`, `adapters/`, an HTTP entry, and a worker entry when step 6 splits a process.
- Zod, Valibot, and ArkType are passed straight to the primitives. A TypeBox 1 schematic goes through `@hexok/typebox` (`typebox(schema)` or `typeboxDecode(schema)`) before it reaches `Schema`, `Entity`, or `Event`.

## When a primitive changes

A change to primitive behavior updates the matching file under `references/` in the same change. `npx skills update` refreshes installed copies from the GitHub repository.
