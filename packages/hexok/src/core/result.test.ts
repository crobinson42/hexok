import { describe, expect, expectTypeOf, it } from 'vitest';
import { fail, ok, type Result } from './result.js';

describe('ok / fail', () => {
  it('wraps a value as ok', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('wraps a code as fail', () => {
    const result = fail('ALREADY_CLOSED');
    expect(result).toEqual({ ok: false, code: 'ALREADY_CLOSED' });
  });

  it('attaches schema issues on fail', () => {
    const result = fail('VALIDATION', [{ message: 'id required' }]);
    expect(result).toEqual({
      ok: false,
      code: 'VALIDATION',
      issues: [{ message: 'id required' }],
    });
  });

  it('infers a closed error union from a ternary', () => {
    const closed = true;
    const next = { id: '1' };
    const result = closed ? fail('ALREADY_CLOSED') : ok(next);

    expectTypeOf(result).toEqualTypeOf<
      Result<{ id: string }, 'ALREADY_CLOSED'>
    >();

    if (result.ok) {
      expectTypeOf(result.value).toEqualTypeOf<{ id: string }>();
    } else {
      expectTypeOf(result.code).toEqualTypeOf<'ALREADY_CLOSED'>();
    }

    expect(result.ok).toBe(false);
  });

  it('ok() error arm is never', () => {
    const result = ok('hello');
    expectTypeOf(result).toEqualTypeOf<Result<string, never>>();
  });

  it('fail() value arm is never', () => {
    const result = fail('NOPE');
    expectTypeOf(result).toEqualTypeOf<Result<never, 'NOPE'>>();
  });
});
