---
title: EventHandler
description: The work that follows one event. Ports come in through the constructor. handle receives the event.
---

An event handler is the work that follows one [event](/hexok/concepts/event/). You name the handler and pass the event class. `handle` receives an instance of that event. Ports, such as a mail sender, arrive through the constructor.

```ts
class EmailSubscribers extends EventHandler('email.subscribers', PostPublished) {}
```

Your application subscribes the handler. An in-memory dispatcher or a queue worker calls `handle` once it has the event.

## Why it exists

The use case that publishes a post is finished once the post is saved and the event is published. Emailing every subscriber can be slow, and it can run in another process. The handler is that second story. It stays tied to one event class, so `event.payload` is the published post and the compiler notices a handler pointed at a different event.

## How it's used

`EmailSubscribers` loads the subscriber list and sends one mail per address. The published post is `event.payload`. A worker, or the API process, constructs the handler with its ports and calls `handle` after it has the event object.

```ts
class EmailSubscribers extends EventHandler('email.subscribers', PostPublished) {
  constructor(
    private readonly subscribers: SubscriberDirectory,
    private readonly mail: MailSender,
  ) {
    super()
  }

  async handle(event: PostPublished): Promise<void> {
    const addresses = await this.subscribers.list()
    for (const address of addresses) {
      await this.mail.send(address, event.payload.title)
    }
  }
}
```

Annotate `event` with `PostPublished`. That is the class passed to `EventHandler`, and it is what types `payload`.

A process that shares the API's memory can pass the instance straight to `handle`. A worker in another process reads a [catalog message](/hexok/concepts/event-catalog/), runs `BlogEvents.parse`, and then calls `handle` with the result. Subscription, ack, and retry belong to that adapter.

## API

`EventHandler(token, event)` returns the class you extend. `token` is a string literal, the handler's name. `event` is an event class.

| Member | Role |
| --- | --- |
| `EmailSubscribers.token` | The name you passed in. |
| `EmailSubscribers.event` | The event class this handler receives. |
| `handle(event)` | Required. Annotate `event` with that class. Return `void` or `Promise<void>`. |
| `constructor` | Receive ports here. |

The compiler reports a missing `handle`. One handler is bound to one event class. A second event is a second handler.

A static field such as `groupId` is yours to read when you subscribe the handler. The factory records the token and the event class.
