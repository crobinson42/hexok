import { describe, expect, expectTypeOf, it } from 'vitest';
import { Port, type PortToken, type PortType } from './port.js';

interface Clock {
  now(): Date;
}

const Clock = Port.token<Clock>('Clock');

describe('Port', () => {
  it('stores the key and freezes the token', () => {
    expect(Clock.key).toBe('Clock');
    expect(Object.isFrozen(Clock)).toBe(true);
    expectTypeOf(Clock.key).toEqualTypeOf<string>();
    expectTypeOf(Clock).toEqualTypeOf<PortToken<Clock>>();
  });

  it('PortType extracts the interface', () => {
    expectTypeOf<PortType<typeof Clock>>().toEqualTypeOf<Clock>();
  });

  it('defaults capability flags to false', () => {
    expect(Clock.capabilities).toEqual({
      transactional: false,
      requestScoped: false,
    });
    expect(Object.isFrozen(Clock.capabilities)).toBe(true);
  });

  it('stores capability flags', () => {
    const Tx = Port.token<Clock>('TxClock', { transactional: true });
    expect(Tx.capabilities.transactional).toBe(true);
    expect(Tx.capabilities.requestScoped).toBe(false);
  });
});
