import { App, InMemoryBus } from '@plinth/testing';
import { describe, expect, it } from 'vitest';
import { AuthorizeInterceptor } from './authorize.js';
import type { AppContext } from './context.js';
import { RequestScopeInterceptor } from './request-scope.js';
import {
  Charge,
  Ledger,
  LedgerEvents,
  MemoryIds,
  MemoryLedger,
  RequestIds,
} from './toy.js';
import { UnitOfWorkInterceptor } from './unit-of-work.js';

function build(ledger = new MemoryLedger(100)) {
  return App.test({ charge: Charge })
    .provide(Ledger, ledger)
    .provide(RequestIds, new MemoryIds())
    .bind(LedgerEvents, InMemoryBus.create())
    .ctx<AppContext>({ principal: { roles: ['ledger:charge'] } })
    .intercept(new AuthorizeInterceptor())
    .intercept(new RequestScopeInterceptor())
    .intercept(new UnitOfWorkInterceptor())
    .build();
}

describe('extend stack', () => {
  it('authorize → request-scope → unit-of-work', async () => {
    const app = build();
    const first = await app.local.ledger.charge({ amount: 10 });
    const second = await app.local.ledger.charge({ amount: 10 });
    expect(first.id).toBe('id-1');
    expect(second.id).toBe('id-1');
    expect(first.balance).toBe(90);
    expect(second.balance).toBe(80);
    expect(app.published).toHaveLength(2);
    expect(app.published[0]?.meta.afterCommit).toBe(true);
  });

  it('forbidden never charges', async () => {
    const ledger = new MemoryLedger(100);
    const app = App.test({ charge: Charge })
      .provide(Ledger, ledger)
      .provide(RequestIds, new MemoryIds())
      .bind(LedgerEvents, InMemoryBus.create())
      .ctx<AppContext>({ principal: { roles: [] } })
      .intercept(new AuthorizeInterceptor())
      .intercept(new RequestScopeInterceptor())
      .intercept(new UnitOfWorkInterceptor())
      .build();
    await expect(app.local.ledger.charge({ amount: 10 })).rejects.toMatchObject(
      {
        code: 'FORBIDDEN',
      },
    );
    expect(ledger.balance).toBe(100);
    expect(app.published).toHaveLength(0);
  });

  it('rollback on throw restores balance and drops publish', async () => {
    const ledger = new MemoryLedger(5);
    const app = build(ledger);
    await expect(app.local.ledger.charge({ amount: 10 })).rejects.toMatchObject(
      {
        code: 'INSUFFICIENT',
      },
    );
    expect(ledger.balance).toBe(5);
    expect(app.published).toHaveLength(0);
  });
});
