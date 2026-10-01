# Event

An event is a fact the application records, such as "this post was published." Name it and give it the schema of its payload. `new` stores a payload you already typed. `parse` checks an unknown value and then constructs the event.

```ts
class PostPublished extends Event('post.published', PostSchema) {}
```

Register the class on an event catalog when a publisher and a subscriber need to agree on the set. An event handler performs the work that follows from one event.

## Why it exists

Publishing a post saves the post. Emailing subscribers is a consequence, and it is a different story: it can fail, retry, and run in another process without changing whether the post is published. The event is the fact the use case records. The handler is where the email happens. The payload schema keeps that fact the same shape on both sides.

## How to use it

The use case constructs the event from the post it just saved and hands it to a publisher port. The handler later reads `event.payload`.

```ts
class PostPublished extends Event('post.published', PostSchema) {}

await events.publish(
  new PostPublished({
    id: post.props.id,
    title: post.props.title,
    body: post.props.body,
    published: true,
  }),
);
```

`new PostPublished(...)` trusts that object. When the payload arrives as unknown JSON, the boundary uses `PostPublished.parse(value)`, or the catalog's `parse` for a `{ key, payload }` message.

The string `'post.published'` is the event's token. A catalog map key, such as `postPublished`, is a separate name.

## API

`Event(token, schema)` returns the class. `token` is a string literal. `schema` is a Standard Schema or a Schema class. A Schema class is stored as its definition.

| Member | Role |
| --- | --- |
| `PostPublished.token` | The name you passed in. |
| `PostPublished.schema` | The payload schema. |
| `new PostPublished(payload)` | Stores `payload`. The constructor expects the schema's output type. |
| `PostPublished.parse(value)` | Checks `value` and returns an instance of the class you called it on. |
| `event.token` | The same literal as the static token. |
| `event.payload` | The payload. |

A rejected `parse` throws `CodedError` with code `VALIDATION` and the message `hexok: post.published validation failed`.

Override `parse` when the boundary needs to preprocess the value. `parse` uses the class it was called on, so a catalog `parse` still returns the registered subclass and `instanceof` holds.

Callers tell two event classes apart with `instanceof` or by comparing `event.token`. Two classes that share a schema stay assignable to each other until the instance token separates them. Prefer the catalog's `EventInstance` union on a publisher port so the port accepts every event in the set.
