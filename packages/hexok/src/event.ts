import { validationError } from './coded-error.js';
import {
  type InferSchema,
  type ResolvedSchema,
  type SchemaSource,
  schemaDefinition,
} from './schema.js';
import { validate } from './validate.js';

/**
 * A fact the domain records. The token and payload schema are arguments.
 * `new` trusts an already-typed payload. `parse` validates unknown input.
 *
 * ```ts
 * class UserCreated extends Event('user.created', userSchema) {}
 * ```
 */
export function Event<const Token extends string, S extends SchemaSource>(
  token: Token,
  schema: S,
) {
  const definition = schemaDefinition(schema);

  class EventClass {
    /** Event name. Literal type of the string passed to {@link Event}. */
    static readonly token: Token = token;
    /** Payload schema. A Schema class is stored as its definition. */
    static readonly schema: ResolvedSchema<S> = definition;

    /** Nominal marker. Each `Event(...)` call is a distinct class. */
    readonly #brand = true;
    /** Typed payload. Not validated in the constructor. */
    readonly payload: InferSchema<S>;

    constructor(payload: InferSchema<S>) {
      this.payload = payload;
      void this.#brand;
    }

    /**
     * Validate `value` and construct an event.
     * Throws `CodedError` `VALIDATION` when the schema rejects it.
     * Override to customize the boundary.
     */
    static parse(value: unknown): EventClass {
      const parsed = validate(definition, value);
      if (!parsed.ok) {
        throw validationError(
          `hexok: ${token} validation failed`,
          parsed.issues,
        );
      }
      return new EventClass(parsed.value as InferSchema<S>);
    }
  }

  return EventClass;
}
