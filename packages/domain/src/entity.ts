import {
  fail,
  type Infer,
  ok,
  type Result,
  type StandardSchemaV1,
  validate,
} from '@plinth/core';

/**
 * Untracked entities are **values**. Domain methods return a new instance
 * via `with`; they never I/O, never publish, never hold ports.
 *
 * ```ts
 * class Incident extends Entity<IncidentProps> {
 *   static readonly type = 'Incident'
 *   static readonly schema = z.object({ id: z.string(), status: z.enum(['open', 'closed']) })
 *   static readonly errors = { ALREADY_CLOSED: { status: 409 } } as const
 *   close(): Result<Incident, 'ALREADY_CLOSED'> {
 *     if (this.props.status === 'closed') return fail('ALREADY_CLOSED')
 *     return ok(this.with({ status: 'closed' }))
 *   }
 * }
 * ```
 */
export abstract class Entity<P> {
  protected _props: P;

  /**
   * Readonly snapshot of schema output. Untracked entities replace this
   * by returning `this.with(patch)` — they do not mutate `props`.
   */
  get props(): P {
    return this._props;
  }

  constructor(props: P) {
    this._props = props;
  }

  /**
   * Immutable copy of the same class (subclass constructor is preserved).
   */
  with(patch: Partial<P>): this {
    const Ctor = this.constructor as new (props: P) => this;
    return new Ctor({ ...this.props, ...patch });
  }

  /** Plain schema output for persistence and RPC. */
  toProps(): P {
    return this.props;
  }

  /** JSON serialization is the plain props snapshot. */
  toJSON(): P {
    return this.props;
  }

  /**
   * Fail with an error code. Annotate the method return as
   * `Result<This, keyof typeof This.errors>` so an undeclared code is a type error.
   */
  fail<K extends string>(code: K): Result<never, K> {
    return fail(code);
  }

  /**
   * Validate typed props and construct a new instance.
   * Tracked subclasses mark the instance `isNew`.
   */
  static create<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T>,
  ): Result<InstanceType<T>, 'VALIDATION'> {
    return instantiate(this, props);
  }

  /**
   * Validate typed props and reconstruct an existing instance.
   * Tracked subclasses snapshot `original`.
   */
  static restore<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T>,
  ): Result<InstanceType<T>, 'VALIDATION'> {
    return instantiate(this, props);
  }

  /**
   * Trust boundary for untyped input. Same validation as create/restore.
   */
  static parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): Result<InstanceType<T>, 'VALIDATION'> {
    return instantiate(this, value);
  }
}

export type EntityConstructor = {
  readonly type: string;
  readonly schema: StandardSchemaV1;
  readonly errors: object;
} & (new (
  props: never,
) => Entity<unknown>);

type SchemaOutput<T extends EntityConstructor> = Infer<T['schema']>;

export function instantiate<T extends EntityConstructor>(
  Ctor: T,
  value: unknown,
): Result<InstanceType<T>, 'VALIDATION'> {
  const parsed = validate(Ctor.schema, value);
  if (!parsed.ok) return parsed;
  const CtorImpl = Ctor as unknown as new (props: unknown) => InstanceType<T>;
  return ok(new CtorImpl(parsed.value));
}
