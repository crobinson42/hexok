import { describe, expectTypeOf, it } from 'vitest';
import type { ErrorMap } from './error-map.js';

describe('ErrorMap', () => {
  it('uses keys as the error union', () => {
    const errors = {
      ALREADY_CLOSED: { message: 'Incident already closed' },
      NOT_FOUND: {},
    } as const satisfies ErrorMap;

    expectTypeOf<keyof typeof errors>().toEqualTypeOf<
      'ALREADY_CLOSED' | 'NOT_FOUND'
    >();
  });
});
