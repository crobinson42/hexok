import { describe, expect, it } from 'vitest';
import { MemoryQuarantine } from './memory-quarantine.js';
import { QuarantineError, type QuarantineInput } from './quarantine.js';

function input(overrides: Partial<QuarantineInput> = {}): QuarantineInput {
  return {
    source: 'email',
    operation: 'send',
    payload: { id: '1' },
    error: { name: 'Error', message: 'down' },
    occurredAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('MemoryQuarantine', () => {
  it('parks an open item and keeps the payload reference', async () => {
    const quarantine = new MemoryQuarantine();
    const payload = { id: '1' };
    const { id } = await quarantine.park(input({ payload, subject: 'key-1' }));
    const item = await quarantine.get(id);
    expect(item?.status).toBe('open');
    expect(item?.subject).toBe('key-1');
    expect(item?.payload).toBe(payload);
    expect(await quarantine.get('missing')).toBeNull();
  });

  it('lists by source, operation, status, and since, newest first', async () => {
    const quarantine = new MemoryQuarantine();
    const older = new Date('2026-01-01T00:00:00.000Z');
    const newer = new Date('2026-01-02T00:00:00.000Z');
    await quarantine.park(input({ occurredAt: older, source: 'sms' }));
    const first = await quarantine.park(input({ occurredAt: newer }));
    const second = await quarantine.park(
      input({ occurredAt: newer, operation: 'publish' }),
    );
    await quarantine.resolve(second.id, 'resolved');

    const listed = await quarantine.list({ source: 'email' });
    expect(listed.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(await quarantine.list({ status: 'resolved' })).toHaveLength(1);
    expect(
      await quarantine.list({ since: newer, operation: 'send' }),
    ).toHaveLength(1);
    expect(await quarantine.list({ source: 'sms' })).toHaveLength(1);
    expect((await quarantine.list({ limit: 1 })).length).toBe(1);
  });

  it('defaults limit to 100 and rejects a limit outside 1..1000', async () => {
    const quarantine = new MemoryQuarantine();
    for (let i = 0; i < 101; i += 1) {
      await quarantine.park(input());
    }
    expect(await quarantine.list()).toHaveLength(100);
    await expect(quarantine.list({ limit: 0 })).rejects.toThrow(
      'quarantine: limit must be 1..1000',
    );
    await expect(quarantine.list({ limit: 1001 })).rejects.toThrow(
      'quarantine: limit must be 1..1000',
    );
  });

  it('resolves once, accepts the same outcome, and refuses a conflict or a missing id', async () => {
    const quarantine = new MemoryQuarantine();
    const { id } = await quarantine.park(input());
    await quarantine.resolve(id, 'resolved');
    await quarantine.resolve(id, 'resolved');
    expect((await quarantine.get(id))?.status).toBe('resolved');
    await expect(quarantine.resolve(id, 'discarded')).rejects.toSatisfy(
      (error: unknown) => QuarantineError.is(error) && error.code === 'Closed',
    );
    await expect(quarantine.resolve('missing', 'discarded')).rejects.toSatisfy(
      (error: unknown) => QuarantineError.is(error) && error.code === 'Missing',
    );
  });
});
