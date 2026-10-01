# Error

An error catalog is the named set of refusals the application throws. Define it with `Errors`, giving the catalog a name and one entry per code. Call sites throw a member. The edge catches the catalog and decides what a caller sees.

```ts
class BlogError extends Errors('blog', {
  BlankTitle: { message: 'Title is blank' },
  AlreadyPublished: { message: 'Post is already published' },
}) {}
```

The shape of each entry is an error map. A failed schema check is a different failure: `CodedError` with code `VALIDATION`.

## Why it exists

Publishing can refuse for reasons the caller can act on. The title is blank. The post is already published. The trace id is missing. A catalog gives each refusal a stable code, a message, and, when the caller needs a value back, a payload such as the post id.

The catalog stays a list of domain facts. Mapping `BlankTitle` to an HTTP status, an RPC code, or a queue retry lives in the gateway or the worker.

## How to use it

The entity throws. The use case lets the error travel. The gateway matches and chooses the reply.

```ts
class Post extends Entity('Post', PostSchema) {
  publish(now: Date): this {
    if (this.props.title.trim() === '') throw BlogError.BlankTitle();
    if (this.props.published) throw BlogError.AlreadyPublished();
    return this.set((draft) => {
      draft.published = true;
      draft.publishedAt = now;
    });
  }
}

try {
  await publishPost.execute({ id });
} catch (error) {
  if (!BlogError.is(error)) throw error;
  return BlogError.match(error, {
    BlankTitle: () => reply(400, error.message),
    AlreadyPublished: () => reply(409, error.message),
  });
}
```

Call the member. `BlogError.BlankTitle()` uses the catalog message. `BlogError.BlankTitle('Title cannot be empty')` replaces it for this throw. `new BlogError.BlankTitle()` throws `TypeError`, because the member is a factory.

`UseCase`, `Entity`, `Port`, `Adapter`, `Schema`, `Mapper`, `Event`, `EventCatalog`, and `EventHandler` do not take an error map. There is no `error()` method on those classes.

## Error map

The object passed to `Errors` is the error map. Each key is a code. Each value is an `ErrorDef`: an optional `message`, and an optional `data` Standard Schema. `ErrorMap` and `ErrorDef` are exported because declaration emit names them.

```ts
class BlogError extends Errors('blog', {
  BlankTitle: { message: 'Title is blank' },
  TraceIdMissing: {},
  PostMissing: {
    message: 'Post was not found',
    data: z.object({ id: z.string() }),
  },
}) {}

throw BlogError.BlankTitle();
throw BlogError.TraceIdMissing();
throw BlogError.PostMissing({ id: 'p1' });
throw BlogError.PostMissing('No post p1', { id: 'p1' });
```

`TraceIdMissing` omits `message`, so the factory's fallback text is the code, `'TraceIdMissing'`. `PostMissing` requires `{ id: string }` because that is the schema's output. The `data` schema types the argument. The factory stores the value it was given and does not validate it. Run the schema yourself before the throw when a bad payload should fail as a schema check.

| Entry | Call |
| --- | --- |
| No `data` | `Code()` or `Code(message)`. |
| `data` whose output is an object or number | `Code(data)` or `Code(message, data)`. |
| `data` whose output is a string | One argument is the payload. The message is first only when the payload follows it: `Code(message, data)`. |

Keys `is`, `match`, `prototype`, and `token` are reserved. Defining one of them throws `hexok: error code "<code>" is reserved`.

## Catalog API

`Errors(token, defs)` returns the class you extend. `token` is the catalog name.

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

The message on the returned error keeps the literal you passed, including a template literal. `is` and `match` type `message` as `string`, because one code can be thrown with the catalog text or an override.

`instanceof BlogError` is the same catalog check as `is`. `is` is what narrows the union so `match` and `code` see each member.

## Coded error

A coded error is a failure identified by a `code` string, with a message and an optional payload. Schema checks throw one whose code is `VALIDATION`. Application refusals use the catalog.

```ts
new CodedError({
  code: 'VALIDATION',
  message: 'hexok: Post validation failed',
  data: { issues },
});
```

Checking a shape and refusing a story are different events. `Post.parse` can reject a body that has no title. `post.publish()` can reject a post that is already live. The gateway shows field errors from `data.issues` and matches catalog members on their own codes.

```ts
try {
  const post = Post.parse(body);
  await posts.save(post);
} catch (error) {
  if (error instanceof CodedError && error.code === 'VALIDATION') {
    return reply(400, error.data);
  }
  throw error;
}
```

The same error is thrown by `Schema.parse`, entity `create`, `parse`, a writing `set`, or `validate`, `Event.parse`, and `EventCatalog.parse` when the payload schema rejects the message. `Entity.restore` does not validate. The next writing `set`, or an explicit `validate()`, can throw.

| Member | Role |
| --- | --- |
| `new CodedError({ code, message?, data? })` | `message` defaults to `code`. `data` is set only when the argument object has a `data` key. |
| `error.code` | The code. Schema checks use `'VALIDATION'`. |
| `error.message` | The message. Schema checks use `` `hexok: ${token} validation failed` ``. |
| `error.data` | Optional payload. For a schema check it is `{ issues }` when the schema reported issues. |
| `error.name` | `'CodedError'`. |
| `validationError(message, issues?)` | Builds a `CodedError<'VALIDATION'>`. Passes `data: { issues }` when `issues` is present. |

An issue is a Standard Schema issue: a `message` and an optional `path`. An async schema throws a plain `Error` with the message `hexok: async schemas belong at the application edge`.

`ok`, `fail`, and `Result` are exported for application code that already returns a result. Entity methods, `execute`, and `handle` throw. They do not return `Result`.
