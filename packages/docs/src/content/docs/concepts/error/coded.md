---
title: Coded error
description: The error a schema check throws, with code VALIDATION and the issue list.
---

A coded error is a failure identified by a `code` string, with a message and an optional payload. Schema checks throw one whose code is `VALIDATION`. Application refusals, such as a blank title, use an [error catalog](/hexok/concepts/error/) instead.

```ts
new CodedError({
  code: 'VALIDATION',
  message: 'hexok: Post validation failed',
  data: { issues },
})
```

## Why it exists

Checking a shape and refusing a story are different events. `Post.parse` can reject a body that has no title. `post.publish()` can reject a post that is already live. The first is the schema speaking. The second is a catalog member your gateway already knows how to match.

`CodedError` gives the schema failure a stable code and the issue list from the Standard Schema, so the edge can show field errors without treating them as `BlankTitle`.

## How it's used

Parsing a request body either returns a post or throws. The gateway reads `data.issues` when it wants to point at the field.

```ts
try {
  const post = Post.parse(body)
  await posts.save(post)
} catch (error) {
  if (error instanceof CodedError && error.code === 'VALIDATION') {
    return reply(400, error.data)
  }
  throw error
}
```

The same error is thrown by a [Schema](/hexok/concepts/schema/) `parse`, an [Entity](/hexok/concepts/entity/) `create`, `parse`, writing `set`, or `validate`, an [Event](/hexok/concepts/event/) `parse`, and [`EventCatalog.parse`](/hexok/concepts/event-catalog/) when the payload schema rejects the message.

## API

| Member | Role |
| --- | --- |
| `new CodedError({ code, message?, data? })` | `message` defaults to `code`. `data` is set only when the argument object has a `data` key. |
| `error.code` | The code. Schema checks use `'VALIDATION'`. |
| `error.message` | The message. Schema checks use `` `hexok: ${token} validation failed` ``. |
| `error.data` | Optional payload. For a schema check it is `{ issues }` when the schema reported issues. |
| `error.name` | `'CodedError'`. |
| `validationError(message, issues?)` | Builds a `CodedError<'VALIDATION'>`. Passes `data: { issues }` when `issues` is present. |

An issue is a Standard Schema issue: a `message` and an optional `path`.

`Entity.restore` returns the stored props as they are. The next writing `set`, or an explicit `validate()`, runs the schema and can throw this error.

An async schema throws a plain `Error` with the message `hexok: async schemas belong at the application edge`.
