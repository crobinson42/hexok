---
title: EventCatalog
description: A named set of event classes, plus the conversion between an event object and a serializable message.
---

An event catalog is the set of [events](/hexok/concepts/event/) one publisher and its subscribers share. You name the catalog and pass a map of event classes. The map key is the name in a serialized message. The event's own token stays the name on the class.

```ts
class BlogEvents extends EventCatalog('blog', {
  postPublished: PostPublished,
}) {}
```

## Why it exists

A use case has a `PostPublished` object. A queue, a log, or another process needs something it can store: a key and a payload. The catalog is the agreement on which events exist, and the two conversions between those forms. `message` turns an instance into `{ key, payload }`. `parse` turns that message back into the event class, checking the payload with the event's schema.

The map key and the event token are different strings on purpose. `postPublished` is the name in the catalog and on the wire message. `post.published` is the token on the class, the same string you passed to `Event`.

## How it's used

The publisher port accepts any instance from the catalog. The adapter that talks to a transport calls `message` on the way out and `parse` on the way in. A handler then receives the event object.

```ts
const message = BlogEvents.message(new PostPublished(post.toProps()))
// { key: 'postPublished', payload: { id, title, body, published } }

const event = BlogEvents.parse(message)
await emailSubscribers.handle(event)
```

An adapter that owns a queue sends `message` and, on the other side, runs `parse` before it calls the handler. `BlogEvents.get('postPublished').token` is `'post.published'`.

Narrow one entry when a function handles a single key: `EventInstance<typeof BlogEvents, 'postPublished'>` and `EventMessage<typeof BlogEvents, 'postPublished'>`.

## API

`EventCatalog(token, events)` returns the class you extend. `token` is a string literal. `events` is a map of event classes. Duplicate event tokens throw `hexok: duplicate event "<token>" in catalog "<name>"` when the class is defined. The map is frozen on the catalog.

| Member | Role |
| --- | --- |
| `BlogEvents.token` | The catalog name. |
| `BlogEvents.events` | The map you passed in. |
| `BlogEvents.get(name)` | The class registered under that map key. An unknown key throws `hexok: event "<name>" is not in catalog "blog"`. |
| `BlogEvents.message(event)` | `{ key, payload }` for an instance of a class in this catalog. `key` is the map key. An event from elsewhere throws `hexok: event "<token>" is not in catalog "blog"`. |
| `BlogEvents.parse(value)` | Checks a `{ key, payload }` message and returns the event instance. |

`parse` throws `hexok: catalog "blog" expected { key, payload }` when `value` lacks a string `key` or a `payload`. An unknown key throws `hexok: event "<key>" is not in catalog "blog"`. A payload the event schema rejects throws a [coded error](/hexok/concepts/error/coded/) `VALIDATION` from that event's `parse`.

`EventInstance<typeof BlogEvents>` is the union of event instances in the catalog. `EventMessage<typeof BlogEvents>` is the matching `{ key, payload }` union. The second type argument keeps one entry. `key` on a message is the map key. The event token is `BlogEvents.get(message.key).token`, and `event.token` on the instance.
