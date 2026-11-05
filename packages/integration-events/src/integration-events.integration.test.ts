import { randomUUID } from 'node:crypto';
import { RedisQueue } from '@hexok/queue-redis';
import { EventHandler } from 'hexok';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Contract } from './contract.js';
import type { IntegrationMeta } from './envelope.js';
import { Message } from './message.js';
import { IntegrationPublisher } from './publisher.js';
import { IntegrationSubscriber } from './subscriber.js';

if (process.env.CI && !process.env.REDIS_URL) {
  throw new Error('REDIS_URL is required when CI is set');
}
const redis = process.env.REDIS_URL ?? '';

// The contract product A publishes and product B imports.
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
class Billing extends Contract('billing', {
  invoices: [InvoicePaid, InvoicePaidV2],
}) {}

async function waitFor(check: () => boolean): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('timed out waiting for deliveries');
}

describe.skipIf(!redis)('integration events over RedisQueue', () => {
  const queues: RedisQueue[] = [];

  afterEach(async () => {
    await Promise.all(queues.splice(0).map((queue) => queue.stop()));
  });

  async function product(keyPrefix: string): Promise<RedisQueue> {
    const queue = new RedisQueue({ redis, keyPrefix });
    queues.push(queue);
    await queue.start();
    return queue;
  }

  it('delivers one publish to each version and each consuming service', async () => {
    const keyPrefix = `hexok:it:integration-events:${randomUUID()}:`;
    const received: string[] = [];
    const metas: IntegrationMeta[] = [];

    class CrmSync extends EventHandler('sync-invoice', InvoicePaid) {
      handle(event: InvoicePaid, meta?: IntegrationMeta): void {
        received.push(`crm v1 ${event.payload.amountCents}`);
        if (meta) metas.push(meta);
      }
    }
    class AnalyticsRecord extends EventHandler(
      'record-invoice',
      InvoicePaidV2,
    ) {
      handle(event: InvoicePaidV2): void {
        received.push(`analytics v2 ${event.payload.amount.currency}`);
      }
    }

    const crm = new IntegrationSubscriber(Billing, {
      queue: await product(keyPrefix),
      service: 'crm',
    });
    const analytics = new IntegrationSubscriber(Billing, {
      queue: await product(keyPrefix),
      service: 'analytics',
    });
    await crm.subscribe({ maxDeliveries: 3, handlers: [new CrmSync()] });
    await analytics.subscribe({
      maxDeliveries: 3,
      handlers: [new AnalyticsRecord()],
    });

    const billing = new IntegrationPublisher(Billing, {
      queue: await product(keyPrefix),
    });
    const id = await billing.publish(
      new InvoicePaidV2({
        invoiceId: 'inv_1',
        amount: { cents: 500, currency: 'USD' },
      }),
      { subject: 'inv_1' },
    );

    await waitFor(() => received.length === 2);
    expect(received.sort()).toEqual(['analytics v2 USD', 'crm v1 500']);
    expect(metas).toEqual([
      { id, source: 'billing', time: expect.any(String), subject: 'inv_1' },
    ]);
  });
});
