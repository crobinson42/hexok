import {
  Queue,
  type QueueDisposition,
  type QueueHandler,
  type QueueSubscribeOptions,
} from '@hexok/queue';
import { Adapter, CodedError, EventHandler } from 'hexok';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Contract } from './contract.js';
import type { IntegrationMeta } from './envelope.js';
import { Message } from './message.js';
import { IntegrationPublisher } from './publisher.js';
import { IntegrationSubscriber, type ParkInput } from './subscriber.js';

class InvoicePaid extends Message(
  'invoice.paid',
  1,
  z.object({ invoiceId: z.string(), amountCents: z.number().int() }),
) {}
class InvoicePaidV2 extends Message(
  'invoice.paid',
  2,
  z.object({
    invoiceId: z.string(),
    amount: z.object({ cents: z.number().int(), currency: z.string() }),
  }),
  {
    downgrade: {
      to: InvoicePaid,
      map: (v2) => ({ invoiceId: v2.invoiceId, amountCents: v2.amount.cents }),
    },
  },
) {}
class InvoiceVoided extends Message(
  'invoice.voided',
  1,
  z.object({ invoiceId: z.string() }),
) {}
class CustomerCreated extends Message(
  'customer.created',
  1,
  z.object({ customerId: z.string() }),
) {}

class Billing extends Contract('billing', {
  invoices: [InvoicePaid, InvoicePaidV2, InvoiceVoided],
  customers: [CustomerCreated],
}) {}

class Outside extends Message('outside', 1, z.object({})) {}

type Delivery = {
  topic: string;
  group: string;
  disposition: QueueDisposition | 'threw';
};

/** Every subscription of a topic receives each publish, once. */
class MemoryQueue extends Adapter(Queue) {
  readonly published: Array<{ topic: string; payload: unknown }> = [];
  readonly deliveries: Delivery[] = [];
  readonly subscribed: Array<{
    topic: string;
    options: QueueSubscribeOptions<unknown>;
  }> = [];
  readonly #handlers = new Map<
    string,
    Array<{ group: string; handler: QueueHandler<unknown> }>
  >();

  async publish(topic: string, payload: unknown): Promise<string> {
    this.published.push({ topic, payload });
    const id = `${this.published.length}-0`;
    for (const { group, handler } of this.#handlers.get(topic) ?? []) {
      try {
        const returned = await handler({ id, topic, payload, deliveries: 1 });
        this.deliveries.push({ topic, group, disposition: returned ?? 'ack' });
      } catch {
        this.deliveries.push({ topic, group, disposition: 'threw' });
      }
    }
    return id;
  }

  async subscribe<T>(
    topic: string,
    options: QueueSubscribeOptions<T>,
  ): Promise<void> {
    const subscriptions = this.#handlers.get(topic) ?? [];
    subscriptions.push({
      group: options.consumerGroup,
      handler: options.handler as QueueHandler<unknown>,
    });
    this.#handlers.set(topic, subscriptions);
    this.subscribed.push({
      topic,
      options: options as QueueSubscribeOptions<unknown>,
    });
  }

  async unsubscribe(): Promise<void> {}
}

const time = new Date('2026-11-05T12:00:00.000Z');

let queue: MemoryQueue;
let publisher: IntegrationPublisher<typeof Billing>;

beforeEach(() => {
  queue = new MemoryQueue();
  publisher = new IntegrationPublisher(Billing, { queue });
});

describe('IntegrationPublisher', () => {
  it('publishes a CloudEvents envelope to the message topic', async () => {
    const id = await publisher.publish(
      new CustomerCreated({ customerId: 'cus_1' }),
    );

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(queue.published).toHaveLength(1);
    const [entry] = queue.published;
    expect(entry?.topic).toBe('billing.customers');
    expect(entry?.payload).toEqual({
      specversion: '1.0',
      id,
      source: 'billing',
      type: 'customer.created',
      version: 1,
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      data: { customerId: 'cus_1' },
    });
    expect(entry?.payload).not.toHaveProperty('subject');
  });

  it('uses the id, time, and subject it is given', async () => {
    const id = await publisher.publish(
      new InvoiceVoided({ invoiceId: 'inv_1' }),
      { id: 'evt_1', time, subject: 'inv_1' },
    );

    expect(id).toBe('evt_1');
    expect(queue.published[0]?.payload).toMatchObject({
      id: 'evt_1',
      time: '2026-11-05T12:00:00.000Z',
      subject: 'inv_1',
    });
  });

  it('publishes the newest version, then each downgrade, with one id', async () => {
    await publisher.publish(
      new InvoicePaidV2({
        invoiceId: 'inv_1',
        amount: { cents: 500, currency: 'USD' },
      }),
      { id: 'evt_1', time },
    );

    expect(queue.published).toEqual([
      {
        topic: 'billing.invoices',
        payload: expect.objectContaining({
          id: 'evt_1',
          type: 'invoice.paid',
          version: 2,
          data: { invoiceId: 'inv_1', amount: { cents: 500, currency: 'USD' } },
        }),
      },
      {
        topic: 'billing.invoices',
        payload: expect.objectContaining({
          id: 'evt_1',
          type: 'invoice.paid',
          version: 1,
          time: '2026-11-05T12:00:00.000Z',
          data: { invoiceId: 'inv_1', amountCents: 500 },
        }),
      },
    ]);
  });

  it('rejects a version that has a newer version', async () => {
    await expect(
      publisher.publish(
        // @ts-expect-error v1 is superseded by v2
        new InvoicePaid({ invoiceId: 'inv_1', amountCents: 500 }),
      ),
    ).rejects.toThrow(
      'integration-events: "invoice.paid" v1 has a newer version in topic "billing.invoices"',
    );
    expect(queue.published).toEqual([]);
  });

  it('rejects a message that is not in the contract', async () => {
    await expect(
      // @ts-expect-error Outside is not in Billing
      publisher.publish(new Outside({})),
    ).rejects.toThrow(
      'integration-events: "outside" v1 is not in contract "billing"',
    );
  });

  it('rejects an invalid payload before publishing', async () => {
    const error = await publisher
      .publish(new InvoiceVoided({ invoiceId: 1 } as never))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CodedError);
    expect(error).toMatchObject({
      code: 'VALIDATION',
      message: 'integration-events: "invoice.voided" v1 validation failed',
    });
    expect(queue.published).toEqual([]);
  });

  it('rejects an invalid downgrade before publishing any version', async () => {
    class V1 extends Message('n', 1, z.object({ a: z.string() })) {}
    class V2 extends Message('n', 2, z.object({ b: z.string() }), {
      downgrade: { to: V1, map: (v2) => ({ a: v2.b.length as never }) },
    }) {}
    class Broken extends Contract('broken', { t: [V1, V2] }) {}
    const broken = new IntegrationPublisher(Broken, { queue });

    await expect(broken.publish(new V2({ b: 'x' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      message: 'integration-events: "n" v1 validation failed',
    });
    expect(queue.published).toEqual([]);
  });
});

describe('IntegrationSubscriber', () => {
  const received: Array<{ event: object; meta: IntegrationMeta | undefined }> =
    [];
  const parked: ParkInput[] = [];
  const logged: Array<{ message: string; fields: unknown }> = [];

  class SyncInvoice extends EventHandler('sync-invoice', InvoicePaid) {
    handle(event: InvoicePaid, meta?: IntegrationMeta): void {
      received.push({ event, meta });
    }
  }
  class SyncInvoiceV2 extends EventHandler('sync-invoice-v2', InvoicePaidV2) {
    handle(event: InvoicePaidV2, meta?: IntegrationMeta): void {
      received.push({ event, meta });
    }
  }
  class CustomerHandler extends EventHandler('customer', CustomerCreated) {
    handle(event: CustomerCreated, meta?: IntegrationMeta): void {
      received.push({ event, meta });
    }
  }
  class FailingHandler extends EventHandler('failing', InvoiceVoided) {
    handle(): void {
      throw new Error('boom');
    }
  }

  let subscriber: IntegrationSubscriber<typeof Billing>;

  beforeEach(() => {
    received.length = 0;
    parked.length = 0;
    logged.length = 0;
    subscriber = new IntegrationSubscriber(Billing, {
      queue,
      service: 'crm',
      logger: {
        error: (message, fields) =>
          logged.push({
            message: message instanceof Error ? message.message : message,
            fields,
          }),
      },
      quarantine: {
        park: async (input) => {
          parked.push(input);
          return { id: String(parked.length) };
        },
      },
    });
  });

  it('subscribes each handler with group <service>:<token>', async () => {
    const subscriptions = await subscriber.subscribe({
      maxDeliveries: 5,
      startFrom: 'earliest',
      handlers: [new SyncInvoice(), new CustomerHandler()],
    });

    expect(subscriptions).toEqual([
      {
        topic: 'billing.invoices',
        group: 'crm:sync-invoice',
        type: 'invoice.paid',
        version: 1,
      },
      {
        topic: 'billing.customers',
        group: 'crm:customer',
        type: 'customer.created',
        version: 1,
      },
    ]);
    expect(queue.subscribed.map((s) => [s.topic, s.options])).toEqual([
      [
        'billing.invoices',
        expect.objectContaining({
          consumerGroup: 'crm:sync-invoice',
          maxDeliveries: 5,
          startFrom: 'earliest',
        }),
      ],
      [
        'billing.customers',
        expect.objectContaining({ consumerGroup: 'crm:customer' }),
      ],
    ]);
  });

  it('omits startFrom when it is not given', async () => {
    await subscriber.subscribe({
      maxDeliveries: 1,
      handlers: [new SyncInvoice()],
    });

    expect(queue.subscribed[0]?.options).not.toHaveProperty('startFrom');
  });

  it('delivers each version to its handler and skips the rest', async () => {
    await subscriber.subscribe({
      maxDeliveries: 5,
      handlers: [new SyncInvoice(), new SyncInvoiceV2()],
    });

    await publisher.publish(
      new InvoicePaidV2({
        invoiceId: 'inv_1',
        amount: { cents: 500, currency: 'USD' },
      }),
      { id: 'evt_1', time, subject: 'inv_1' },
    );
    await publisher.publish(new InvoiceVoided({ invoiceId: 'inv_1' }));

    expect(received).toHaveLength(2);
    const [v2, v1] = received;
    expect(v2?.event).toBeInstanceOf(InvoicePaidV2);
    expect(v1?.event).toBeInstanceOf(InvoicePaid);
    expect((v1?.event as InvoicePaid | undefined)?.payload).toEqual({
      invoiceId: 'inv_1',
      amountCents: 500,
    });
    expect(v1?.meta).toEqual({
      id: 'evt_1',
      source: 'billing',
      time: '2026-11-05T12:00:00.000Z',
      subject: 'inv_1',
    });
    expect(queue.deliveries.every((d) => d.disposition === 'ack')).toBe(true);
    expect(queue.deliveries).toHaveLength(6);
  });

  it('omits subject from meta when the envelope has none', async () => {
    await subscriber.subscribe({
      maxDeliveries: 1,
      handlers: [new CustomerHandler()],
    });
    await publisher.publish(new CustomerCreated({ customerId: 'cus_1' }));

    expect(received[0]?.meta).not.toHaveProperty('subject');
  });

  it('parks and drops an entry that is not an envelope', async () => {
    await subscriber.subscribe({
      maxDeliveries: 1,
      handlers: [new SyncInvoice()],
    });
    await queue.publish('billing.invoices', { hello: 'world' });

    expect(received).toEqual([]);
    expect(queue.deliveries).toEqual([
      {
        topic: 'billing.invoices',
        group: 'crm:sync-invoice',
        disposition: 'drop',
      },
    ]);
    expect(logged).toEqual([
      {
        message: 'integration-events: entry is not an integration event',
        fields: {
          topic: 'billing.invoices',
          group: 'crm:sync-invoice',
          id: '1-0',
        },
      },
    ]);
    expect(parked).toEqual([
      {
        source: 'integration-events',
        operation: 'deliver',
        subject: 'billing.invoices:1-0',
        payload: { hello: 'world' },
        error: {
          name: 'Error',
          message: 'integration-events: entry is not an integration event',
        },
        occurredAt: expect.any(Date),
        context: { group: 'crm:sync-invoice' },
      },
    ]);
  });

  it('parks and drops data its schema rejects', async () => {
    await subscriber.subscribe({
      maxDeliveries: 1,
      handlers: [new SyncInvoice()],
    });
    await queue.publish('billing.invoices', {
      specversion: '1.0',
      id: 'evt_1',
      source: 'billing',
      type: 'invoice.paid',
      version: 1,
      time: time.toISOString(),
      data: { invoiceId: 'inv_1' },
    });

    expect(received).toEqual([]);
    expect(queue.deliveries[0]?.disposition).toBe('drop');
    expect(parked[0]?.error).toEqual({
      name: 'CodedError',
      message: 'hexok: invoice.paid validation failed',
      code: 'VALIDATION',
    });
  });

  it('logs a failed park and still drops', async () => {
    const failing = new IntegrationSubscriber(Billing, {
      queue,
      service: 'crm',
      logger: {
        error: (message, fields) =>
          logged.push({
            message: message instanceof Error ? message.message : message,
            fields,
          }),
      },
      quarantine: {
        park: async () => {
          throw new Error('quarantine down');
        },
      },
    });
    await failing.subscribe({
      maxDeliveries: 1,
      handlers: [new SyncInvoice()],
    });
    await queue.publish('billing.invoices', null);

    expect(queue.deliveries[0]?.disposition).toBe('drop');
    expect(logged.map((entry) => entry.message)).toEqual([
      'integration-events: entry is not an integration event',
      'quarantine down',
    ]);
  });

  it('lets a handler throw so the queue retries', async () => {
    await subscriber.subscribe({
      maxDeliveries: 3,
      handlers: [new FailingHandler()],
    });
    await publisher.publish(new InvoiceVoided({ invoiceId: 'inv_1' }));

    expect(queue.deliveries).toEqual([
      { topic: 'billing.invoices', group: 'crm:failing', disposition: 'threw' },
    ]);
    expect(parked).toEqual([]);
  });

  it('rejects a handler whose message is not in the contract', async () => {
    class OutsideHandler extends EventHandler('outside', Outside) {
      handle(): void {}
    }

    await expect(
      subscriber.subscribe({
        maxDeliveries: 1,
        // @ts-expect-error Outside is not in Billing
        handlers: [new SyncInvoice(), new OutsideHandler()],
      }),
    ).rejects.toThrow(
      'integration-events: handler "outside" handles "outside" v1, which is not in contract "billing"',
    );
    expect(queue.subscribed).toEqual([]);
  });

  it('rejects two handlers that share a group on one topic', async () => {
    class Twin extends EventHandler('sync-invoice', InvoiceVoided) {
      handle(): void {}
    }
    const message =
      'integration-events: group "crm:sync-invoice" on topic "billing.invoices" is already subscribed. Give each handler its own token';

    await expect(
      subscriber.subscribe({
        maxDeliveries: 1,
        handlers: [new SyncInvoice(), new Twin()],
      }),
    ).rejects.toThrow(message);
    expect(queue.subscribed).toEqual([]);

    await subscriber.subscribe({
      maxDeliveries: 1,
      handlers: [new SyncInvoice()],
    });
    await expect(
      subscriber.subscribe({ maxDeliveries: 1, handlers: [new Twin()] }),
    ).rejects.toThrow(message);
  });

  it('rejects a bad service name', () => {
    for (const service of ['', 'c:rm', 'c rm']) {
      expect(
        () => new IntegrationSubscriber(Billing, { queue, service }),
      ).toThrow(`integration-events: service "${service}" must match`);
    }
  });
});
