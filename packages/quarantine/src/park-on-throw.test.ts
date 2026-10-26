import { describe, expect, it } from 'vitest';
import { MemoryQuarantine } from './memory-quarantine.js';
import { parkOnThrow } from './park-on-throw.js';

describe('parkOnThrow', () => {
  it('does not park a success', async () => {
    const quarantine = new MemoryQuarantine();
    await expect(
      parkOnThrow(
        quarantine,
        { source: 'billing', operation: 'charge', payload: {} },
        async () => 1,
      ),
    ).resolves.toBe(1);
    expect(await quarantine.list()).toHaveLength(0);
  });

  it('parks and rethrows the original error', async () => {
    const quarantine = new MemoryQuarantine();
    const original = new Error('down');
    await expect(
      parkOnThrow(
        quarantine,
        { source: 'billing', operation: 'charge', payload: { id: '1' } },
        async () => {
          throw original;
        },
      ),
    ).rejects.toBe(original);
    const [item] = await quarantine.list();
    expect(item?.error).toEqual({ name: 'Error', message: 'down' });
    expect(item?.payload).toEqual({ id: '1' });
  });

  it('calls onParkError and still rethrows the original when park throws', async () => {
    const original = new Error('down');
    const parkError = new Error('store down');
    const seen: unknown[] = [];
    await expect(
      parkOnThrow(
        {
          async park() {
            throw parkError;
          },
        },
        { source: 'billing', operation: 'charge', payload: {} },
        async () => {
          throw original;
        },
        (error) => {
          seen.push(error);
        },
      ),
    ).rejects.toBe(original);
    expect(seen).toEqual([parkError]);
  });
});
