# EventCatalog

An event catalog is the set of events one publisher and its subscribers share. Name the catalog and pass a map of event classes. The map key is the name in a serialized message. The event's own token stays the name on the class.

```ts
class BlogEvents extends EventCatalog('blog', {
  postPublished: PostPublished,
}) {}
```

## Why it exists

A use case has a `PostPublished` object. A queue, a log, or another process needs something it can store: a key and a payload. The catalog is the agreement on which events exist, and the two conversions between those forms. `message` turns an instance into `{ key, payload }`. `parse` turns that message back into the event class, checking the payload with the event's schema.

The map key and the event token are different strings on purpose. `postPublished` is the name in the catalog and on the wire message. `post.published` is the token on the class, the same string passed to `Event`.

## How to use it

The publisher port accepts any instance from the catalog. The adapter that talks to a transport calls `message` on the way out and `parse` on the way in. A handler then receives the event object.

```ts
abstract class BlogEventPublisher extends Port('BlogEventPublisher') {
  abstract publish(event: EventInstance<typeof BlogEvents>): Promise<void>;
}

const message = BlogEvents.message(new PostPublished(post.toProps()));
// { key: 'postPublished', payload: { id, title, body, published } }

const event = BlogEvents.parse(message);
await emailSubscribers.handle(event);
```

`publish` takes the instance union. A generic `publish<K>(key, payload)` does not keep the payload paired with the key inside the method. The use case publishes the instance. The adapter converts it.

`BlogEvents.get('postPublished').token` is `'post.published'`.

Narrow one entry when a function handles a single key: `EventInstance<typeof BlogEvents, 'postPublished'>` and `EventMessage<typeof BlogEvents, 'postPublished'>`.

A port parameter typed as the catalog class does not check event key or payload, because a catalog instance has no fields. Use `typeof BlogEvents` when the type you need is the static side.

## API

`EventCatalog(token, events)` returns the class you extend. `token` is a string literal. `events` is a map of event classes. Duplicate event tokens throw `hexok: duplicate event "<token>" in catalog "<name>"` when the class is defined. The map is frozen on the catalog.

| Member | Role |
| --- | --- |
| `BlogEvents.token` | The catalog name. |
| `BlogEvents.events` | The map you passed in. |
| `BlogEvents.get(name)` | The class registered under that map key. An unknown key throws `hexok: event "<name>" is not in catalog "blog"`. |
| `BlogEvents.message(event)` | `{ key, payload }` for an instance of a class in this catalog. `key` is the map key. An event from elsewhere throws `hexok: event "<token>" is not in catalog "blog"`. |
| `BlogEvents.parse(value)` | Checks a `{ key, payload }` message and returns the event instance. |

`parse` throws `hexok: catalog "blog" expected { key, payload }` when `value` lacks a string `key` or a `payload`. An unknown key throws `hexok: event "<key>" is not in catalog "blog"`. A payload the event schema rejects throws `CodedError` `VALIDATION` from that event's `parse`.

`EventInstance<typeof BlogEvents>` is the union of event instances in the catalog. Each instance carries its token. `EventMessage<typeof BlogEvents>` is the matching `{ key, payload }` union. The second type argument keeps one entry. `key` on a message is the map key. The event token is `BlogEvents.get(message.key).token`, and `event.token` on the instance.

Narrow a handler or a switch with `event.token` or `instanceof`. Indexing a handler map by `event.token` does not narrow the payload. A `never` default on the whole event reports an unhandled catalog entry.
