# EventHandler

An event handler is the work that follows one event. Name the handler and pass the event class. `handle` receives an instance of that event. Ports, such as a mail sender, arrive through the constructor.

```ts
class EmailSubscribers extends EventHandler('email.subscribers', PostPublished) {}
```

The application subscribes the handler. An in-process dispatcher or a queue worker calls `handle` once it has the event. The handler does not subscribe itself.

## Why it exists

The use case that publishes a post is finished once the post is saved and the event is published. Emailing every subscriber can be slow, and it can run in another process. The handler is that second story. It stays tied to one event class, so `event.payload` is the published post and the compiler notices a handler pointed at a different event.

## How to use it

`EmailSubscribers` loads the subscriber list and sends one mail per address. The published post is `event.payload`.

```ts
class EmailSubscribers extends EventHandler('email.subscribers', PostPublished) {
  constructor(
    private readonly subscribers: SubscriberDirectory,
    private readonly mail: MailSender,
  ) {
    super();
  }

  async handle(event: PostPublished): Promise<void> {
    const addresses = await this.subscribers.list();
    for (const address of addresses) {
      await this.mail.send(address, event.payload.title);
    }
  }
}
```

Annotate `event` with `PostPublished`. An unannotated `handle(event)` is implicit `any`. Keep `handle` a method.

A process that shares the API's memory can pass the instance straight to `handle`. A worker in another process reads a catalog message, runs `BlogEvents.parse`, and then calls `handle` with the result. Subscription, ack, and retry belong to that adapter.

One handler is bound to one event class. A second event is a second handler.

A static field such as `groupId` is yours to read when you subscribe the handler. Hexok does not read it. Same group string is one competing consumer set only for a real broker. Different groups each receive the event. An in-memory adapter may ignore the group.

## API

`EventHandler(token, event)` returns the class you extend. `token` is a string literal, the handler's name. `event` is an event class.

| Member | Role |
| --- | --- |
| `EmailSubscribers.token` | The name you passed in. |
| `EmailSubscribers.event` | The event class this handler receives. |
| `handle(event)` | Required. Annotate `event` with that class. Return `void` or `Promise<void>`. |
| `constructor` | Receive ports here and call `super()`. |

The compiler reports a missing `handle`. The factory records the token and the event class. It takes no consumer-group argument.
