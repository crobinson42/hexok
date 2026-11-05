import { CodedError, Event, EventHandler } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import type { IntegrationMeta } from './envelope.js';
import { Message } from './message.js';

const paidV1 = z.object({ invoiceId: z.string(), amountCents: z.number() });
const paidV2 = z.object({
  invoiceId: z.string(),
  amount: z.object({ cents: z.number(), currency: z.string() }),
});

class InvoicePaid extends Message('invoice.paid', 1, paidV1) {}
class InvoicePaidV2 extends Message('invoice.paid', 2, paidV2, {
  downgrade: {
    to: InvoicePaid,
    map: (v2) => ({ invoiceId: v2.invoiceId, amountCents: v2.amount.cents }),
  },
}) {}

describe('Message', () => {
  it('is an Event with a version', () => {
    const event = new InvoicePaid({ invoiceId: 'inv_1', amountCents: 500 });

    expect(InvoicePaid.token).toBe('invoice.paid');
    expect(InvoicePaid.version).toBe(1);
    expect(InvoicePaid.downgrade).toBeUndefined();
    expect(event.token).toBe('invoice.paid');
    expect(event.version).toBe(1);
    expect(event.payload).toEqual({ invoiceId: 'inv_1', amountCents: 500 });
    expectTypeOf(InvoicePaid.version).toEqualTypeOf<1>();
    expectTypeOf(event.payload).toEqualTypeOf<{
      invoiceId: string;
      amountCents: number;
    }>();
  });

  it('stores the downgrade', () => {
    expect(InvoicePaidV2.downgrade.to).toBe(InvoicePaid);
    expect(
      InvoicePaidV2.downgrade.map({
        invoiceId: 'inv_1',
        amount: { cents: 500, currency: 'USD' },
      }),
    ).toEqual({ invoiceId: 'inv_1', amountCents: 500 });
    expect(Object.isFrozen(InvoicePaidV2.downgrade)).toBe(true);
  });

  it('types the downgrade map from both schemas', () => {
    const typed = () =>
      Message('invoice.paid', 2, paidV2, {
        downgrade: {
          to: InvoicePaid,
          map: (v2) => ({
            invoiceId: v2.invoiceId,
            // @ts-expect-error v1 amountCents is a number
            amountCents: 'five',
          }),
        },
      });
    void typed;
  });

  it('parses into the subclass', () => {
    const event = InvoicePaid.parse({ invoiceId: 'inv_1', amountCents: 500 });

    expect(event).toBeInstanceOf(InvoicePaid);
    expectTypeOf(event).toEqualTypeOf<InvoicePaid>();
    expect(() => InvoicePaid.parse({ invoiceId: 1 })).toThrow(CodedError);
  });

  it('works with EventHandler and an optional meta argument', async () => {
    const seen: string[] = [];
    class SyncInvoice extends EventHandler('sync-invoice', InvoicePaid) {
      handle(event: InvoicePaid, meta?: IntegrationMeta): void {
        seen.push(`${event.payload.invoiceId}:${meta?.id}`);
      }
    }

    new SyncInvoice().handle(
      new InvoicePaid({ invoiceId: 'inv_1', amountCents: 1 }),
      { id: 'e1', source: 'billing', time: '2026-01-01T00:00:00.000Z' },
    );

    expect(seen).toEqual(['inv_1:e1']);
  });

  it('rejects a bad type or version', () => {
    expect(() => Message('', 1, paidV1)).toThrow(
      'integration-events: message type must be a string',
    );
    for (const version of [0, -1, 1.5, Number.NaN]) {
      expect(() => Message('invoice.paid', version, paidV1)).toThrow(
        'integration-events: "invoice.paid" version must be a positive integer',
      );
    }
  });

  it('rejects a downgrade to another type or a later version', () => {
    const message =
      'integration-events: "invoice.paid" v2 must downgrade to an earlier version of "invoice.paid"';
    class Other extends Message('invoice.voided', 1, paidV1) {}
    class Later extends Message('invoice.paid', 3, paidV1) {}

    expect(() =>
      Message('invoice.paid', 2, paidV1, {
        downgrade: { to: Other, map: (v) => v },
      }),
    ).toThrow(message);
    expect(() =>
      Message('invoice.paid', 2, paidV1, {
        downgrade: { to: Later, map: (v) => v },
      }),
    ).toThrow(message);
    expect(() =>
      Message('invoice.paid', 2, paidV1, {
        downgrade: {
          to: Event('invoice.paid', paidV1) as never,
          map: (v) => v as never,
        },
      }),
    ).toThrow(message);
  });

  it('rejects a downgrade map that is not a function', () => {
    expect(() =>
      Message('invoice.paid', 2, paidV1, {
        downgrade: { to: InvoicePaid, map: undefined as never },
      }),
    ).toThrow(
      'integration-events: "invoice.paid" v2 downgrade map must be a function',
    );
  });
});
