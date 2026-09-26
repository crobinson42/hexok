import { describe, expectTypeOf, it } from 'vitest';
import type { ErrorMap } from './error-map.js';

describe('ErrorMap', () => {
  it('uses keys as the code union', () => {
    const errors = {
      AlreadyClosed: { message: 'Incident already closed' },
      NotFound: {},
    } as const satisfies ErrorMap;

    expectTypeOf<keyof typeof errors>().toEqualTypeOf<
      'AlreadyClosed' | 'NotFound'
    >();
  });
});
