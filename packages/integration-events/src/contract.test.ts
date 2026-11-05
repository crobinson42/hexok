import { Event } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { Contract, type ContractEvent } from './contract.js';
import { Message } from './message.js';

const invoice = z.object({ invoiceId: z.string() });

class InvoicePaid extends Message('invoice.paid', 1, invoice) {}
class InvoicePaidV2 extends Message('invoice.paid', 2, invoice, {
  downgrade: { to: InvoicePaid, map: (v2) => v2 },
}) {}
class InvoiceVoided extends Message('invoice.voided', 1, invoice) {}
class CustomerCreated extends Message(
  'customer.created',
  1,
  z.object({ customerId: z.string() }),
) {}

class Billing extends Contract('billing', {
  invoices: [InvoicePaid, InvoicePaidV2, InvoiceVoided],
  customers: [CustomerCreated],
}) {}

describe('Contract', () => {
  it('names each topic <contract>.<key>', () => {
    expect(Billing.token).toBe('billing');
    expect(Billing.topics.invoices.name).toBe('billing.invoices');
    expect(Billing.topics.customers.name).toBe('billing.customers');
    expect(Billing.topics.invoices.messages).toEqual([
      InvoicePaid,
      InvoicePaidV2,
      InvoiceVoided,
    ]);
    expect(Object.isFrozen(Billing.topics)).toBe(true);
    expect(Object.isFrozen(Billing.topics.invoices.messages)).toBe(true);
    expectTypeOf(
      Billing.topics.invoices.name,
    ).toEqualTypeOf<'billing.invoices'>();
  });

  it('types ContractEvent as every message except a superseded version', () => {
    expectTypeOf<ContractEvent<typeof Billing>>().toEqualTypeOf<
      InvoicePaidV2 | InvoiceVoided | CustomerCreated
    >();
  });

  it('rejects a bad contract or topic name', () => {
    expect(() => Contract('bill ing', { a: [InvoicePaid] })).toThrow(
      'integration-events: contract name "bill ing" must match',
    );
    expect(() => Contract('billing.v1', { a: [InvoicePaid] })).toThrow(
      'contract name "billing.v1"',
    );
    expect(() => Contract('billing', { 'in.voices': [InvoicePaid] })).toThrow(
      'integration-events: topic name "in.voices" must match',
    );
  });

  it('rejects an empty topic', () => {
    expect(() => Contract('billing', { invoices: [] })).toThrow(
      'integration-events: topic "billing.invoices" has no messages',
    );
  });

  it('rejects a class that is not a Message', () => {
    class Plain extends Event('invoice.paid', invoice) {}
    expect(() => Contract('billing', { invoices: [Plain as never] })).toThrow(
      'integration-events: topic "billing.invoices" holds a class that is not a Message',
    );
  });

  it('rejects a message in two topics', () => {
    expect(() =>
      Contract('billing', { a: [InvoiceVoided], b: [InvoiceVoided] }),
    ).toThrow(
      'integration-events: "invoice.voided" v1 is in topics "billing.a" and "billing.b"',
    );
  });

  it('rejects two classes with one type and version', () => {
    class Again extends Message('invoice.voided', 1, invoice) {}
    expect(() =>
      Contract('billing', { invoices: [InvoiceVoided, Again] }),
    ).toThrow(
      'integration-events: "invoice.voided" v1 is in topic "billing.invoices" twice',
    );
  });

  it('rejects a newer version without a downgrade', () => {
    class VoidedV2 extends Message('invoice.voided', 2, invoice) {}
    expect(() =>
      Contract('billing', { invoices: [InvoiceVoided, VoidedV2] }),
    ).toThrow(
      'integration-events: "invoice.voided" v2 must downgrade to the v1 in topic "billing.invoices"',
    );
  });

  it('rejects a downgrade to a version that is not in the topic', () => {
    expect(() => Contract('billing', { invoices: [InvoicePaidV2] })).toThrow(
      'integration-events: "invoice.paid" v2 downgrades to v1, which is not in topic "billing.invoices"',
    );
  });

  it('rejects a downgrade that skips a version in the topic', () => {
    class InvoicePaidV3 extends Message('invoice.paid', 3, invoice, {
      downgrade: { to: InvoicePaid, map: (v3) => v3 },
    }) {}
    expect(() =>
      Contract('billing', {
        invoices: [InvoicePaidV3, InvoicePaid, InvoicePaidV2],
      }),
    ).toThrow(
      'integration-events: "invoice.paid" v3 must downgrade to the v2 in topic "billing.invoices"',
    );
  });
});
