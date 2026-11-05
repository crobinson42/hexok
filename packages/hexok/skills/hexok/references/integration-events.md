# Integration events

An integration event is a fact one application publishes for other applications that deploy on their own, such as a second product or a service another team owns. It comes from `@hexok/integration-events`, not from `hexok`. Read the package README for the full guarantees.

A domain event stays inside one application and changes with it. An integration event is a contract. Do not publish a domain event to another application. Map it to an integration event at the edge.

Use an integration event only when a consumer deploys apart from the producer. Two processes of one application, such as an API and its worker, share a catalog and use `Event` and `EventCatalog`.

## Contract

The producer owns the contract file. It imports `@hexok/integration-events`, a schema library, and nothing else from the producer. Consumers import it from a package the producer publishes, a shared workspace, or a copy.

```ts
import { Contract, Message } from '@hexok/integration-events';

export class PostPublished extends Message('post.published', 1, z.object({
  postId: z.string(),
  title: z.string(),
})) {}

export class Blog extends Contract('blog', {
  posts: [PostPublished],
}) {}
```

`Message(type, version, schema)` is an `Event` with a `version`. `Contract(name, topics)` maps each key to its messages. The queue topic is `<name>.<key>`, here `blog.posts`.

## Producer

The use case depends on a port. The adapter wraps `IntegrationPublisher`.

```ts
abstract class BlogIntegrationEvents extends Port('BlogIntegrationEvents') {
  abstract publish(event: ContractEvent<typeof Blog>): Promise<string>;
}

class QueueBlogIntegrationEvents extends Adapter(BlogIntegrationEvents) {
  readonly #publisher: IntegrationPublisher<typeof Blog>;

  constructor(private readonly deps: { readonly queue: Queue }) {
    super();
    this.#publisher = new IntegrationPublisher(Blog, deps);
  }

  override publish(event: ContractEvent<typeof Blog>): Promise<string> {
    return this.#publisher.publish(event);
  }
}
```

The use case publishes after its save succeeds, as it does a domain event. When the application already publishes a domain event, an event handler can map it to the integration event and publish that.

## Consumer

Each handler is an `EventHandler` for one message. The worker entry subscribes them.

```ts
class ProjectPost extends EventHandler('project-post', PostPublished) {
  constructor(private readonly deps: { readonly posts: PostProjection }) {
    super();
  }

  async handle(event: PostPublished, meta?: IntegrationMeta): Promise<void> {
    await this.deps.posts.upsert(event.payload, meta?.id);
  }
}

const blog = new IntegrationSubscriber(Blog, { queue, service: 'search', logger, quarantine });
await blog.subscribe({ maxDeliveries: 10, handlers: [new ProjectPost({ posts })] });
```

`service` names the consuming application. Each handler gets the consumer group `<service>:<handler token>`. Give each handler its own token. Delivery is at least once. Make `handle` idempotent with `meta.id`.

## Versions

- An additive change keeps the version. Consumer schemas accept unknown fields.
- A breaking change is a new `Message` of the same type and the next version, with `downgrade: { to, map }` to the previous one. Add it to the same topic. One `publish` of the newest version sends every version in the topic.
- `publish` accepts only the newest version.
- Retire an old version after every consumer moves. Remove it from the topic and remove the downgrade that targets it.

## What the application owns

Retention, backfill for a new consumer, order between redeliveries, the outbox, and topic permissions in the broker.
