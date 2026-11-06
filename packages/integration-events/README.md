# @hexok/integration-events

Versioned events that cross a product or service boundary. Install with `npm i @hexok/integration-events`. It publishes and subscribes through the `@hexok/queue` port, so any `Queue` adapter carries it, such as `@hexok/queue-redis`.

A domain event is internal to one application and changes with it. An integration event is a published contract between applications that deploy on their own. Map a domain event to an integration event at the edge. Do not publish the domain event.

## Define the contract

The producing product owns the contract. The contract file imports `@hexok/integration-events`, a schema library, and nothing else from the product. Consumers import it from a package the producer publishes, from a shared workspace, or from a copy.

```ts
import { Contract, Message } from '@hexok/integration-events';
import { z } from 'zod';

export class InvoicePaid extends Message('invoice.paid', 1, z.object({
  invoiceId: z.string(),
  amountCents: z.number().int(),
})) {}

export class InvoiceVoided extends Message('invoice.voided', 1, z.object({
  invoiceId: z.string(),
})) {}

export class Billing extends Contract('billing', {
  invoices: [InvoicePaid, InvoiceVoided],
}) {}
```

`Message(type, version, schema)` is a hexok `Event` with a static and instance `version`. `parse` and `EventHandler` work on it.

Contract schemas describe JSON, the form the queue carries. `Date`, `bigint`, `Map`, and `Set` do not survive it. Use strings and numbers, such as an ISO string for a time. A `z.date()` field fails at `publish`.

`Contract(name, topics)` maps each key to the message classes on that topic. The queue topic is `<name>.<key>`, here `billing.invoices`. Names match `/^[A-Za-z0-9_-]+$/`. `Contract` throws when a topic is empty, when a class is not a `Message`, when a class is in two topics, or when two classes share a type and version in one topic.

## Publish

```ts
import { IntegrationPublisher } from '@hexok/integration-events';

const billing = new IntegrationPublisher(Billing, { queue });
await billing.publish(new InvoicePaid({ invoiceId: 'inv_1', amountCents: 500 }));
```

`publish` takes any message in the contract and finds its topic. It validates the JSON form of the payload and sends that JSON form, so a consumer parsing it with the same schema accepts it. Keys the schema would strip are sent, so leave out what consumers should not see. A payload the schema rejects, or one that is not JSON, such as a `bigint` or a cycle, throws `CodedError` `VALIDATION` before anything is sent. It resolves the envelope `id`.

Pass `{ id, time, subject }` to set those envelope attributes. `id` defaults to a random UUID. Pass a stable id, such as an outbox row id, so a retried publish carries the same id. `subject` is usually the aggregate id.

Use cases depend on a port. `ContractEvent<typeof Billing>` is the union of messages the publisher accepts.

```ts
abstract publish(event: ContractEvent<typeof Billing>): Promise<string>;
```

## Subscribe

```ts
import { EventHandler } from 'hexok';
import { IntegrationSubscriber, type IntegrationMeta } from '@hexok/integration-events';
import { Billing, InvoicePaid } from '@acme/billing-contract';

class SyncInvoice extends EventHandler('sync-invoice', InvoicePaid) {
  async handle(event: InvoicePaid, meta?: IntegrationMeta): Promise<void> {
    // meta.id to dedupe, meta.time and meta.subject to order
  }
}

const billing = new IntegrationSubscriber(Billing, { queue, service: 'crm' });
await billing.subscribe({ maxDeliveries: 10, handlers: [new SyncInvoice(deps)] });
```

`service` names the consuming application. Each handler subscribes to the topic of its message with its own consumer group, `<service>:<handler token>`. Two services never share a group, so each receives every event. A failing handler does not redeliver to the others.

`subscribe` checks every handler and reserves every group before it subscribes any. It throws when a handler's message is not in the contract, or when two handlers would share a group on one topic, even across concurrent calls. When a queue subscribe fails, the handlers that call subscribed are unsubscribed and the error is rethrown. A failed `subscribe` leaves nothing subscribed and can be retried. A group whose unsubscribe also fails stays reserved, and subscribing it again on that instance throws. It resolves `{ topic, group, type, version }` for each subscription. `maxDeliveries` and `startFrom` pass through to `Queue.subscribe`.

For each delivery:

- An event of another type or version is acked and skipped.
- A payload that is not an envelope, or data the message schema rejects, is logged, parked, and dropped. Pass a structural `logger` and `quarantine`. `@hexok/logger` and `@hexok/quarantine` fit them. A parked record has `source: 'integration-events'`, `operation: 'deliver'`, `subject` `topic:id`, `context.group`, and `attempts`, the delivery count. A schema rejection has `error.code` `VALIDATION`. When the park fails, the delivery throws, and the queue retries it up to `maxDeliveries`. Without a `quarantine`, the entry is logged and dropped. Each handler has its own group, so a malformed entry is parked once for each handler on its topic.
- `handle` receives the event and an `IntegrationMeta` of `{ id, source, time, subject }`. A throw follows the queue's retry rules.

Delivery is at least once. Make handlers idempotent with `meta.id`.

## Versions

An additive change, such as a new optional field, keeps the version. Consumer schemas must accept unknown fields. Zod, Valibot, and TypeBox objects accept them by default.

A breaking change is a new version of the same type, with a downgrade to the previous version.

```ts
export class InvoicePaidV2 extends Message('invoice.paid', 2, z.object({
  invoiceId: z.string(),
  amount: z.object({ cents: z.number().int(), currency: z.string() }),
}), {
  downgrade: {
    to: InvoicePaid,
    map: (v2) => ({ invoiceId: v2.invoiceId, amountCents: v2.amount.cents }),
  },
}) {}

export class Billing extends Contract('billing', {
  invoices: [InvoicePaid, InvoicePaidV2, InvoiceVoided],
}) {}
```

`map` is typed from both schemas. One `publish` of v2 sends v2, then v1. Every copy has the same `id`, `time`, and `subject`. Each payload is validated before it is downgraded, and `map` receives the schema's output. A failure throws before anything is sent. A queue failure rejects `publish`, and copies already sent stay sent.

`publish` accepts only the newest version. An older version is a type error, and it throws at runtime. `ContractEvent` leaves it out.

The versions of one type in a topic form a chain. Each version downgrades to the one before it. `Contract` throws when a version has no downgrade, skips a version, or downgrades to a version that is not in the topic.

To retire v1, move every consumer to v2. Then remove v1 from the topic and the downgrade from v2. Publish that as a major version of the contract.

Retire a version only after its consumers move. A handler for a version the producer no longer sends receives nothing, and nothing is logged. A consumer that updates to the contract without that version throws at `subscribe`, because its handler's message is no longer in the contract.

## Envelope

The queue payload is a CloudEvents 1.0 event in structured JSON mode, with a `version` extension attribute. Applications in other languages read it as JSON.

```json
{
  "specversion": "1.0",
  "id": "7f8d3a5e-…",
  "source": "billing",
  "type": "invoice.paid",
  "version": 1,
  "time": "2026-11-05T12:00:00.000Z",
  "subject": "inv_1",
  "data": { "invoiceId": "inv_1", "amountCents": 500 }
}
```

`subject` is present only when the publisher passed one.

## What it leaves to the application

- Retention. The queue adapter decides how long entries stay. With `@hexok/queue-redis`, the publisher's `retentionMs` and `maxLen` decide it, and a consumer that is down longer loses entries.
- Backfill. A new consumer reaches only the entries the queue still holds. Load earlier state from the producer another way.
- Order. A queue can redeliver an entry after newer ones. Put an aggregate version or timestamp in the payload, and ignore a change older than the state you hold.
- The outbox. A crash between a database commit and `publish` loses the event. A transactional outbox prevents that. Pass the outbox row id as `id`.
- Read cost. Every handler reads every entry on its topic, each version copy and each type, and skips the ones that are not its own. Keep topics narrow, such as one per aggregate.
- Topic ownership. Grant the producer write access to its topics and consumers read access, in the broker.
