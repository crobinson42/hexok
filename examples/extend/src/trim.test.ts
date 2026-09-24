import { describe, expect, it } from 'vitest';
import { FixedClock, TrimmedName } from './trim.js';

describe('overrides', () => {
  it('trims before the schema runs', () => {
    expect(TrimmedName.parse('  Ada  ')).toBe('Ada');
    expect(() => TrimmedName.parse('   ')).toThrow();
  });

  it('starts the clock before it answers', async () => {
    const clock = new FixedClock();
    expect(() => clock.now()).toThrow(/not started/);
    await clock.start();
    expect(clock.now()).toEqual(new Date(0));
  });
});
