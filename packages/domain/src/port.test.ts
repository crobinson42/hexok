import { describe, expect, expectTypeOf, it } from 'vitest';
import { Port, type PortToken, type PortType } from './port.js';

interface Clock {
  now(): Date;
}

const Clock = Port.token<Clock>('Clock');

describe('Port', () => {
  it('stores a literal key and freezes the token', () => {
    expect(Clock.key).toBe('Clock');
    expect(Object.isFrozen(Clock)).toBe(true);
    expectTypeOf(Clock.key).toEqualTypeOf<string>();
  });

  it('keeps a literal key when Key is passed explicitly', () => {
    const NamedClock = Port.token<Clock, 'Clock'>('Clock');
    expectTypeOf(NamedClock.key).toEqualTypeOf<'Clock'>();
    expectTypeOf<PortType<typeof NamedClock>>().toEqualTypeOf<Clock>();
  });

  it('infers a literal key from the curried form', () => {
    const CurriedClock = Port.token<Clock>()('Clock');
    expect(CurriedClock.key).toBe('Clock');
    expect(Object.isFrozen(CurriedClock)).toBe(true);
    expectTypeOf(CurriedClock.key).toEqualTypeOf<'Clock'>();
    expectTypeOf<PortType<typeof CurriedClock>>().toEqualTypeOf<Clock>();
    expectTypeOf(CurriedClock).toEqualTypeOf<PortToken<Clock, 'Clock'>>();
  });

  it('PortType extracts the interface', () => {
    expectTypeOf<PortType<typeof Clock>>().toEqualTypeOf<Clock>();
  });
});
