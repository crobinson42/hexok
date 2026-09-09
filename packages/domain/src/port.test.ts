import { describe, expect, expectTypeOf, it } from 'vitest';
import { Port, type PortType } from './port.js';

interface Clock {
  now(): Date;
}

const Clock = Port.token<Clock>('Clock');

describe('Port', () => {
  it('stores a literal name and freezes the token', () => {
    expect(Clock.name).toBe('Clock');
    expect(Object.isFrozen(Clock)).toBe(true);
    expectTypeOf(Clock.name).toEqualTypeOf<string>();
  });

  it('PortType extracts the interface', () => {
    expectTypeOf<PortType<typeof Clock>>().toEqualTypeOf<Clock>();
  });
});
