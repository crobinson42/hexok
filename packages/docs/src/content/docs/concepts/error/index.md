---
title: Error
description: A catalog of named refusals a use case, entity, or handler can throw.
---

An error catalog is the named set of refusals your application throws. You define it with `Errors`, giving the catalog a name and one entry per code. Call sites throw a member. The edge catches the catalog and decides what a caller sees.

```ts
class BlogError extends Errors('blog', {
  BlankTitle: { message: 'Title is blank' },
  AlreadyPublished: { message: 'Post is already published' },
}) {}
```

The shape of each entry is an [error map](/hexok/concepts/error/map/). A failed schema check is a different failure: a [coded error](/hexok/concepts/error/coded/) with code `VALIDATION`.

## Why it exists

Publishing can refuse for reasons the caller can act on. The title is blank. The post is already published. The trace id is missing. A single `Error` string leaves the gateway guessing which refusal it caught. A catalog gives each refusal a stable code, a message, and, when the caller needs a value back, a payload such as the post id.

The catalog stays a list of domain facts. Mapping `BlankTitle` to an HTTP status, an RPC code, or a queue retry lives in the gateway or the worker, which imports `BlogError` and matches on the code.

## How it's used

The entity throws. The use case lets the error travel. The gateway matches and chooses the reply.

```ts
class Post extends Entity('Post', PostSchema) {
  publish(now: Date): this {
    if (this.props.title.trim() === '') throw BlogError.BlankTitle()
    if (this.props.published) throw BlogError.AlreadyPublished()
    return this.set((draft) => {
      draft.published = true
      draft.publishedAt = now
    })
  }
}

try {
  await publishPost.execute({ id })
} catch (error) {
  if (!BlogError.is(error)) throw error
  return BlogError.match(error, {
    BlankTitle: () => reply(400, error.message),
    AlreadyPublished: () => reply(409, error.message),
  })
}
```

Call the member. `BlogError.BlankTitle()` uses the catalog message. `BlogError.BlankTitle('Title cannot be empty')` replaces it for this throw. `new BlogError.BlankTitle()` throws `TypeError`, because the member is a factory.

## API

`Errors(token, defs)` returns the class you extend. `token` is a string literal, the catalog name. `defs` is an [`ErrorMap`](/hexok/concepts/error/map/). Codes named `is`, `match`, `prototype`, or `token` throw `hexok: error code "<code>" is reserved` when the catalog is defined.

| Member | Role |
| --- | --- |
| `BlogError.token` | The catalog name. |
| `BlogError.BlankTitle(...)` | Builds that member. You throw the return value. |
| `BlogError.is(error)` | True when `error` is a member of this catalog. Narrows to the union of members. |
| `BlogError.match(error, cases)` | Runs the handler for `error.code`. Every code in the catalog is required. A code that is missing at runtime throws `hexok: unmatched blog.<code>`. |
| `error.catalog` | The catalog token. |
| `error.code` | The member code, such as `'BlankTitle'`. |
| `error.message` | The catalog message, or the override passed at the call. |
| `error.data` | The payload, or `undefined` when the definition has no `data` schema. |
| `error.name` | `` `${token}.${code}` ``, such as `'blog.BlankTitle'`. |

`instanceof BlogError` is the same catalog check as `is`. `is` is what narrows the union so `match` and `code` see each member.

Calls depend on whether the [definition](/hexok/concepts/error/map/) has a `data` schema:

| Definition | Calls |
| --- | --- |
| Message only | `BlankTitle()` uses the catalog message, or the code when `message` is omitted. `BlankTitle('custom')` uses that string. |
| Message and `data` | `UserExists({ id })` uses the catalog message. `UserExists('User ada already exists', { id })` overrides it. |

The message on the returned error keeps the literal you passed, including a template literal. `is` and `match` type `message` as `string`, because one code can be thrown with the catalog text or an override.

The `data` schema types the argument. The factory stores the value it was given.
