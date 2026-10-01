---
title: Schema
description: A named Standard Schema that checks a value and returns its output.
---

A schema names a shape of data and checks values against it. You pass the name and a [Standard Schema](https://standardschema.dev) to `Schema`. `parse` returns the schema's output, or throws when the value does not fit.

```ts
class PostSchema extends Schema('Post', postSchema) {}
```

Zod, Valibot, ArkType, and any other Standard Schema library are passed straight through. `@hexok/typebox` adapts a TypeBox 1 schematic into a Standard Schema first.

## Why it exists

A post is an id, a title, a body, and a published flag. That shape shows up on the entity, on the event that says the post was published, and at the edge where a request body arrives. One named schema is the definition those sites share. The name is what appears in the failure message, so a rejected post is distinguishable from a rejected subscriber.

## How it's used

Define the post once. The entity and the published-post event both take `PostSchema`. At a trust boundary, `parse` turns unknown JSON into the typed output.

```ts
const post = PostSchema.parse({
  id: 'p1',
  title: 'Hello',
  body: 'First post',
  published: false,
})
```

`post.title` is a string because the schema says so. A missing title throws a [coded error](/hexok/concepts/error/coded/) whose code is `VALIDATION` and whose message is `hexok: Post validation failed`.

An [entity](/hexok/concepts/entity/) or an [event](/hexok/concepts/event/) can also take the Standard Schema directly, without this class. Reach for `Schema` when you want the name, `parse`, and a place to customize the check.

## API

`Schema(token, definition)` returns the class you extend. `token` is a string literal. `definition` is a Standard Schema.

| Member | Role |
| --- | --- |
| `PostSchema.token` | The name you passed in. |
| `PostSchema.definition` | The Standard Schema this class wraps. |
| `PostSchema.parse(value)` | Check `value` and return the schema output. |
| `PostSchema.check(value)` | The same check. Overrides of `parse` call this when they want the default result. |

A rejected value throws [`CodedError`](/hexok/concepts/error/coded/) with code `VALIDATION`. `data.issues` is the Standard Schema issue list when the schema reported one. Each issue has a `message` and an optional `path`.

Override `parse` to preprocess or postprocess. Override `check` when the check itself should change.

`schemaDefinition(schema)` reads the Standard Schema out of either a Schema class or a raw Standard Schema. `InferSchema<S>` is the output type of either form. An async schema throws `Error` with the message `hexok: async schemas belong at the application edge`.
