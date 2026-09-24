import { validationError } from './coded-error.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import { type Infer, validate } from './validate.js';

/** A Standard Schema value, or a {@link Schema} class that wraps one. */
export type SchemaSource =
  | StandardSchemaV1
  | { readonly definition: StandardSchemaV1 };

/** The Standard Schema inside `S`, or `S` itself when it already is one. */
export type ResolvedSchema<S> = S extends {
  readonly definition: infer D extends StandardSchemaV1;
}
  ? D
  : S extends StandardSchemaV1
    ? S
    : never;

/** Output of a schema value or a Schema class. */
export type InferSchema<S extends SchemaSource> = Infer<ResolvedSchema<S>>;

function isSchemaClass(
  value: SchemaSource,
): value is { readonly definition: StandardSchemaV1 } {
  if (!('definition' in value)) return false;
  const definition = value.definition;
  return (
    typeof definition === 'object' &&
    definition !== null &&
    '~standard' in definition
  );
}

/** Read the Standard Schema from a schema value or a Schema class. */
export function schemaDefinition<S extends SchemaSource>(
  schema: S,
): ResolvedSchema<S> {
  if (isSchemaClass(schema)) return schema.definition as ResolvedSchema<S>;
  return schema as ResolvedSchema<S>;
}

/**
 * Named schema. The token and the Standard Schema are arguments, so neither
 * can be omitted. Override `parse` or `check` to customize.
 *
 * ```ts
 * class UserSchema extends Schema('User', z.object({ id: z.string() })) {}
 * ```
 */
export function Schema<const Token extends string, S extends StandardSchemaV1>(
  token: Token,
  definition: S,
) {
  abstract class SchemaClass {
    /** Schema name. Literal type of the string passed to {@link Schema}. */
    static readonly token: Token = token;
    /** The Standard Schema this class wraps. */
    static readonly definition: S = definition;

    /**
     * Validate `value` and return the schema output.
     * Throws `CodedError` `VALIDATION` when the schema rejects it.
     * Override to preprocess or postprocess.
     */
    static parse(value: unknown): Infer<S> {
      return SchemaClass.check(value);
    }

    /** Same as {@link parse}, but returns the schema output for overrides that call `super`. */
    static check(value: unknown): Infer<S> {
      const parsed = validate(definition, value);
      if (!parsed.ok) {
        throw validationError(
          `hexok: ${token} validation failed`,
          parsed.issues,
        );
      }
      return parsed.value;
    }
  }

  return SchemaClass;
}
