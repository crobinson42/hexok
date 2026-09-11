import { ApiUseCase, type ExecuteCtx } from 'hexok/app';
import type { Infer } from 'hexok/core';
import type { RequestScoped, Transactional, UnitOfWork } from 'hexok/domain';
import { DomainEvent, EventCatalog, Port } from 'hexok/domain';
import { z } from 'zod';

export class LedgerCharged extends DomainEvent {
  static readonly key = 'ledger.charged';
  static readonly schema = z.object({ amount: z.number() });
  constructor(public readonly payload: Infer<typeof LedgerCharged.schema>) {
    super();
  }
}

export const LedgerEvents = new EventCatalog('ledger', { kind: 'bus' }).event(
  LedgerCharged,
);

export interface Ledger {
  charge(amount: number): Promise<number>;
}
export const Ledger = Port.token<Ledger & Transactional<Ledger>>('Ledger');

export interface RequestIds {
  next(): string;
}
export const RequestIds = Port.token<RequestIds & RequestScoped<RequestIds>>(
  'RequestIds',
);

export class Charge extends ApiUseCase {
  static readonly key = 'ledger.charge';
  static readonly policy = 'ledger:charge';
  static readonly input = z.object({ amount: z.number() });
  static readonly output = z.object({ balance: z.number(), id: z.string() });
  static readonly errors = {
    FORBIDDEN: { message: 'Forbidden' },
    INSUFFICIENT: { message: 'Insufficient funds' },
  } as const;
  static readonly ports = { ledger: Ledger, ids: RequestIds };
  static readonly publishes = [LedgerEvents] as const;

  async execute({ input, ports, errors, publish }: ExecuteCtx<typeof Charge>) {
    const id = ports.ids.next();
    try {
      const balance = await ports.ledger.charge(input.amount);
      publish(new LedgerCharged({ amount: input.amount }));
      return { balance, id };
    } catch {
      throw errors.INSUFFICIENT();
    }
  }
}

export class MemoryLedger implements Ledger, Transactional<Ledger> {
  balance: number;
  constructor(balance: number) {
    this.balance = balance;
  }
  async charge(amount: number): Promise<number> {
    if (this.balance < amount) throw new Error('insufficient');
    this.balance -= amount;
    return this.balance;
  }
  bindTo(uow: UnitOfWork): Ledger {
    const pending = this.balance;
    uow.onRollback(() => {
      this.balance = pending;
    });
    return this;
  }
}

export class MemoryIds implements RequestIds, RequestScoped<RequestIds> {
  #n = 0;
  next(): string {
    this.#n += 1;
    return `id-${this.#n}`;
  }
  fork(): RequestIds {
    const child = new MemoryIds();
    child.#n = 0;
    return child;
  }
}
