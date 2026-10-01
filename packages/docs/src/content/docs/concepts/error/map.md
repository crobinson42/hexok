---
title: Error map
description: The definition object passed to Errors — one entry per code, with an optional message and payload schema.
---

An error map is the object you pass to [`Errors`](/hexok/concepts/error/). Each key is a code. Each value says what that refusal looks like: the default message, and the payload a caller must supply when the refusal carries data.

```ts
const blogErrors = {
  BlankTitle: { message: 'Title is blank' },
  PostMissing: { message: 'Post was not found', data: z.object({ id: z.string() }) },
} satisfies ErrorMap
```

`ErrorDef` is one entry. `ErrorMap` is the record of entries.

## Why it exists

The catalog class is a small surface: throw a member, test it with `is`, branch with `match`. The variation between refusals sits in the definition, before the class exists. A blank title needs only a sentence. A missing post needs the id that was asked for, so the gateway can name it in the reply. Keeping that in the map leaves the [Error](/hexok/concepts/error/) page about throwing and matching.

## How it's used

Write the map as the second argument of `Errors`. Codes that carry a value name a Standard Schema under `data`. Codes that are only a sentence omit it.

```ts
class BlogError extends Errors('blog', {
  BlankTitle: { message: 'Title is blank' },
  TraceIdMissing: {},
  PostMissing: {
    message: 'Post was not found',
    data: z.object({ id: z.string() }),
  },
}) {}

throw BlogError.BlankTitle()
throw BlogError.TraceIdMissing()
throw BlogError.PostMissing({ id: 'p1' })
throw BlogError.PostMissing('No post p1', { id: 'p1' })
```

`TraceIdMissing` omits `message`, so the factory's fallback text is the code, `'TraceIdMissing'`. `PostMissing` requires the object `{ id: string }` because that is the schema's output.

## API

`ErrorDef` has two optional fields.

| Field | Role |
| --- | --- |
| `message` | Default text. When it is omitted, the factory uses the code. A call can still pass a different message. |
| `data` | A Standard Schema for the payload. The member factory then requires that schema's output. |

`ErrorMap` is `Record<string, ErrorDef>`. The keys become the codes on the catalog.

What you can pass follows from `data`:

| Entry | Call |
| --- | --- |
| No `data` | `Code()` or `Code(message)`. |
| `data` whose output is an object or number | `Code(data)` or `Code(message, data)`. |
| `data` whose output is a string | One argument is the payload. The message is first only when the payload follows it: `Code(message, data)`. |

`data` types the factory argument. The factory stores the value you pass. Run the schema yourself before the throw when a bad payload should fail as a schema check.

Keys `is`, `match`, `prototype`, and `token` are reserved. Defining one of them throws `hexok: error code "<code>" is reserved`.
