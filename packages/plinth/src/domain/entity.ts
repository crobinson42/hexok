import {
  CodedError,
  type ErrorMap,
  type Infer,
  type StandardSchemaV1,
  validate,
} from '../core/index.js';

/**
 * Untracked entities are **values**. Domain methods return a new instance
 * via `with`; they never I/O, never publish, never hold ports.
 *
 * Validation, invariants, and declared refusals **throw**. Methods that
 * cannot fail return `this` (or a new instance) with no wrapper.
 *
 * ```ts
 * class Incident extends Entity<IncidentProps> {
 *   static readonly key = 'Incident'
 *   static readonly schema = z.object({ id: z.string(), status: z.enum(['open', 'closed']) })
 *   static readonly errors = { ALREADY_CLOSED: { message: 'Incident already closed' } } as const
 *   close(): Incident {
 *     if (this.props.status === 'closed') this.error('ALREADY_CLOSED')
 *     return this.with({ status: 'closed' })
 *   }
 * }
 * ```
 */
export abstract class Entity<P> {
  static readonly key: string;
  protected _props: P;

  /**
   * Readonly snapshot of schema output. Untracked entities replace this
   * by returning `this.with(patch)` — they do not mutate `props`.
   */
  get props(): P {
    return this._props;
  }

  protected constructor(props: P) {
    this._props = props;
  }

  /**
   * Immutable copy of the same class (subclass constructor is preserved).
   */
  with(patch: Partial<P>): this {
    const Ctor = this.constructor as new (props: P) => this;
    return new Ctor({ ...this.props, ...patch });
  }

  /** Plain schema output for persistence and use-case output. */
  toProps(): P {
    return this.props;
  }

  /** JSON serialization is the plain props snapshot. */
  toJSON(): P {
    return this.props;
  }

  /**
   * Throw a declared entity error. Codes are the keys of the subclass
   * `static errors` when called as `Incident.error('ALREADY_CLOSED')`.
   * An undeclared code is a type error on that call, and a programming
   * error at runtime.
   */
  static error<E extends object, K extends keyof E & string>(
    this: { errors: E; key: string },
    code: K,
    data?: unknown,
  ): never {
    throwEntityError(this, code, data);
  }

  /**
   * Same throw as the static `error`, from an instance. Prefer
   * `Incident.error('ALREADY_CLOSED')` when you want the code checked
   * against `static errors` at compile time.
   */
  error(code: string, data?: unknown): never {
    const Ctor = this.constructor as unknown as {
      errors: ErrorMap;
      key: string;
    };
    throwEntityError(Ctor, code, data);
  }

  /**
   * Validate typed props and construct a new instance.
   * Tracked subclasses mark the instance `isNew`.
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static create<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T>,
  ): T['prototype'] {
    return instantiate(this, props);
  }

  /**
   * Validate typed props and reconstruct an existing instance.
   * Tracked subclasses snapshot `original`.
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static restore<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T>,
  ): T['prototype'] {
    return instantiate(this, props);
  }

  /**
   * Trust boundary for untyped input. Same validation as create/restore.
   * Throws `CodedError` `VALIDATION` if the schema rejects the value.
   */
  static parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): T['prototype'] {
    return instantiate(this, value);
  }
}

export type EntityConstructor = {
  readonly key: string;
  readonly schema: StandardSchemaV1;
  readonly errors: ErrorMap;
  readonly prototype: Entity<unknown>;
};

type SchemaOutput<T extends EntityConstructor> = Infer<T['schema']>;

export function instantiate<T extends EntityConstructor>(
  Ctor: T,
  value: unknown,
): T['prototype'] {
  const parsed = validate(Ctor.schema, value);
  if (!parsed.ok) {
    throw new CodedError({
      code: 'VALIDATION',
      message: `plinth: ${Ctor.key} validation failed`,
    });
  }
  const CtorImpl = Ctor as unknown as new (props: unknown) => T['prototype'];
  return new CtorImpl(parsed.value);
}

function throwEntityError(
  ctor: { errors: object; key: string },
  code: string,
  data?: unknown,
): never {
  const def = (ctor.errors as ErrorMap)[code];
  if (def === undefined) {
    throw new Error(`plinth: undeclared error "${code}" on ${ctor.key}`);
  }
  throw new CodedError({
    code,
    message: def.message ?? code,
    ...(data !== undefined ? { data } : {}),
  });
}
