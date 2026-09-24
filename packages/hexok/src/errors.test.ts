import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { Errors } from './errors.js';

const idSchema = z.object({ id: z.string() });

class DomainError extends Errors('domain', {
  BlankName: { message: 'Name is blank' },
  UserExists: { message: 'User already exists', data: idSchema },
}) {}

class AuthError extends Errors('auth', {
  NotFound: { message: 'Missing', data: idSchema },
}) {}

function takesDomain(error: ReturnType<typeof DomainError.UserExists>): void {
  void error;
}
// @ts-expect-error AuthError.NotFound is not a DomainError member
takesDomain(AuthError.NotFound({ id: '1' }));

describe('Errors', () => {
  it('returns a member the caller can throw', () => {
    const blank = DomainError.BlankName();
    expect(blank).toBeInstanceOf(Error);
    expect(blank).toBeInstanceOf(DomainError);
    expect(blank).not.toBeInstanceOf(AuthError);
    expect(blank.message).toBe('Name is blank');
    expect(blank.code).toBe('BlankName');
    expect(blank.catalog).toBe('domain');
    expect(blank.name).toBe('domain.BlankName');
    expect(DomainError.token).toBe('domain');
    expect(DomainError.is(blank)).toBe(true);
    expect(AuthError.is(blank)).toBe(false);
    expect(DomainError.is({ code: 'BlankName' })).toBe(false);

    const exists = DomainError.UserExists({ id: '1' });
    expect(exists.data).toEqual({ id: '1' });
    expect(
      DomainError.match(exists, {
        BlankName: () => 400,
        UserExists: (error) => error.data.id.length + 408,
      }),
    ).toBe(409);
    expectTypeOf(exists.data.id).toEqualTypeOf<string>();
    expectTypeOf(blank.code).toEqualTypeOf<'BlankName'>();
    function status(error: unknown): 'blank' | 409 | 500 {
      if (!DomainError.is(error)) return 500;
      return DomainError.match(error, {
        BlankName: () => 'blank' as const,
        UserExists: () => 409 as const,
      });
    }
    expectTypeOf(status(exists)).toEqualTypeOf<'blank' | 409 | 500>();
  });

  it('rejects a reserved code', () => {
    expect(() => Errors('domain', { is: { message: 'no' } })).toThrow(
      /reserved/,
    );
  });

  it('blocks a bad call at the type level', () => {
    if (false as boolean) {
      // @ts-expect-error data is required
      DomainError.UserExists();
      // @ts-expect-error BlankName takes no data
      DomainError.BlankName({ id: '1' });
      // @ts-expect-error unknown code
      DomainError.Nope();
      // @ts-expect-error match must list every code
      DomainError.match(DomainError.BlankName(), { BlankName: () => 1 });
      // @ts-expect-error constructor is blocked
      new DomainError();
      // @ts-expect-error a lookalike is not a member
      takesDomain({
        code: 'UserExists',
        catalog: 'domain',
        message: 'User already exists',
        data: { id: '1' },
        name: 'domain.UserExists',
      });
    }
  });
});
