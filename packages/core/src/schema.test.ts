import { describe, expect, expectTypeOf, it } from 'vitest';
import { type Infer, validate } from './schema.js';
import type { StandardSchemaV1 } from './standard-schema.js';

function schemaOf<T>(
  validateFn: (value: unknown) => StandardSchemaV1.Result<T>,
): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: validateFn,
      types: {
        input: undefined as unknown as T,
        output: undefined as unknown as T,
      },
    },
  };
}

describe('validate', () => {
  it('returns ok with the typed output', () => {
    const schema = schemaOf<{ id: string }>((value) => {
      if (typeof value === 'object' && value !== null && 'id' in value) {
        return { value: { id: String((value as { id: unknown }).id) } };
      }
      return { issues: [{ message: 'id required' }] };
    });

    type Out = Infer<typeof schema>;
    expectTypeOf<Out>().toEqualTypeOf<{ id: string }>();

    const result = validate(schema, { id: '1' });
    expect(result).toEqual({ ok: true, value: { id: '1' } });
  });

  it('collapses issues to VALIDATION', () => {
    const schema = schemaOf<string>(() => ({ issues: [{ message: 'nope' }] }));
    const result = validate(schema, 1);
    expect(result).toEqual({ ok: false, code: 'VALIDATION' });
  });

  it('throws when the schema validate is async', () => {
    const asyncSchema: StandardSchemaV1<string, string> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: 'x' }),
        types: {
          input: undefined as unknown as string,
          output: undefined as unknown as string,
        },
      },
    };

    expect(() => validate(asyncSchema, 'x')).toThrow(
      'plinth: async schemas belong at the RPC boundary',
    );
  });
});
