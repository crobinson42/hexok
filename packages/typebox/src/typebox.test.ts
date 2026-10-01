import {
  CodedError,
  Entity,
  Errors,
  type Infer,
  Schema,
  validate,
} from 'hexok';
import Type, { Codec, type Static, type StaticDecode } from 'typebox';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { typebox, typeboxDecode } from './typebox.js';

const userSchema = Type.Object({
  id: Type.String(),
});

const profileSchema = Type.Object({
  profile: Type.Object({
    name: Type.String(),
  }),
});

const slashSchema = Type.Object({
  'a/b': Type.String(),
});

const Timestamp = Codec(Type.String())
  .Decode((value) => new Date(value))
  .Encode((date) => date.toISOString());

class UserSchema extends Schema('User', typebox(userSchema)) {}
class User extends Entity('User', typebox(userSchema)) {}

class DomainError extends Errors('domain', {
  Missing: { message: 'missing', data: typebox(userSchema) },
}) {}

describe('typebox', () => {
  it('infers Static through Schema, Entity, and Errors', () => {
    type SchemaOut = Infer<typeof UserSchema.definition>;
    expectTypeOf<SchemaOut>().toEqualTypeOf<Static<typeof userSchema>>();
    expectTypeOf<SchemaOut>().toEqualTypeOf<{ id: string }>();

    expectTypeOf<User['props']>().toEqualTypeOf<{ readonly id: string }>();

    const missing = DomainError.Missing({ id: '1' });
    expectTypeOf(missing.data).toEqualTypeOf<{ id: string }>();
    expect(missing.data).toEqual({ id: '1' });
  });

  it('parses a valid value and rejects an invalid one', () => {
    expect(UserSchema.parse({ id: '1' })).toEqual({ id: '1' });
    expect(User.parse({ id: '1' }).props).toEqual({ id: '1' });

    const parsed = validate(typebox(userSchema), { id: '1' });
    expect(parsed).toEqual({ ok: true, value: { id: '1' } });

    const failed = validate(typebox(userSchema), {});
    expect(failed).toEqual({
      ok: false,
      code: 'VALIDATION',
      issues: [{ message: 'must have required properties id' }],
    });

    expect(() => User.parse({ id: 1 })).toThrow(CodedError);
    try {
      User.parse({ id: 1 });
    } catch (error) {
      expect(error).toBeInstanceOf(CodedError);
      if (!(error instanceof CodedError)) throw error;
      expect(error.code).toBe('VALIDATION');
      expect(error.data).toEqual({
        issues: [{ message: 'must be string', path: ['id'] }],
      });
    }
  });

  it('maps nested paths and unescapes JSON pointers', () => {
    const nested = validate(typebox(profileSchema), {
      profile: { name: 1 },
    });
    expect(nested).toEqual({
      ok: false,
      code: 'VALIDATION',
      issues: [{ message: 'must be string', path: ['profile', 'name'] }],
    });

    const slash = validate(typebox(slashSchema), { 'a/b': 1 });
    expect(slash).toEqual({
      ok: false,
      code: 'VALIDATION',
      issues: [{ message: 'must be string', path: ['a/b'] }],
    });
  });

  it('reuses one wrapper across calls', () => {
    const schema = typebox(userSchema);
    expect(validate(schema, { id: '1' })).toEqual({
      ok: true,
      value: { id: '1' },
    });
    expect(validate(schema, { id: '2' })).toEqual({
      ok: true,
      value: { id: '2' },
    });
  });
});

describe('typeboxDecode', () => {
  it('checks the encode type and returns the decoded type', () => {
    const encoded = typebox(Timestamp);
    const decoded = typeboxDecode(Timestamp);
    const iso = '2020-01-02T00:00:00.000Z';

    expectTypeOf<Infer<typeof encoded>>().toEqualTypeOf<
      Static<typeof Timestamp>
    >();
    expectTypeOf<Infer<typeof encoded>>().toEqualTypeOf<string>();
    expectTypeOf<Infer<typeof decoded>>().toEqualTypeOf<
      StaticDecode<typeof Timestamp>
    >();
    expectTypeOf<Infer<typeof decoded>>().toEqualTypeOf<Date>();

    expect(validate(encoded, iso)).toEqual({ ok: true, value: iso });
    expect(validate(encoded, new Date(iso))).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });

    const result = validate(decoded, iso);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeInstanceOf(Date);
    expect(result.value.toISOString()).toBe(iso);

    const rejected = validate(decoded, 1);
    expect(rejected).toEqual({
      ok: false,
      code: 'VALIDATION',
      issues: [{ message: 'must be string' }],
    });

    expect(validate(decoded, iso).ok).toBe(true);
  });
});
