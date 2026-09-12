import {
  CodedError,
  type ErrorMap,
  type Infer,
  type StandardSchemaV1,
  validate,
  validationError,
} from '../core/index.js';
import {
  applyCowDraft,
  cloneValue,
  frozenSnapshot,
  isPlainObject,
} from './cow-draft.js';

const EMPTY_CHANGED_KEYS: string[] = Object.freeze([]) as unknown as string[];

/** Recursively readonly view of entity props. `Date` values stay `Date`. */
export type DeepReadonly<T> = T extends Date
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

/**
 * Aggregates mutate **this** via `set` and return `this`.
 * They never I/O, never publish, never hold ports.
 *
 * Validation, invariants, and declared refusals **throw**.
 * `create` / `parse` run the schema. `restore` does not — it rehydrates
 * mapper output as-is. `set` re-runs the schema after a write.
 * `validate()` is the optional fail-fast for a restored instance.
 *
 * ```ts
 * class Incident extends Entity<IncidentProps> {
 *   static readonly key = 'Incident'
 *   static readonly schema = z.object({ id: z.string(), status: z.enum(['open', 'closed']) })
 *   static readonly errors = { ALREADY_CLOSED: { message: 'Incident already closed' } } as const
 *   close(now: Date): this {
 *     if (this.props.status === 'closed') Incident.error('ALREADY_CLOSED')
 *     return this.set((draft) => {
 *       draft.status = 'closed'
 *       draft.closedAt = now
 *     })
 *   }
 * }
 * ```
 */
export abstract class Entity<P extends object> {
  /** Entity name used in validation and undeclared-error messages. Declare on each subclass. */
  static readonly key: string;
  /** Standard Schema for `create` / `parse` / `set` / `validate()`. Declare on each subclass. */
  static readonly schema: StandardSchemaV1;
  /** Declared refusal codes. Keys are the `error()` union. Declare on each subclass. */
  static readonly errors: ErrorMap;
  #isNew = false;
  #validated = false;
  #original: P | undefined = undefined;
  #owned: WeakSet<object> | undefined = undefined;
  #snapshot: P | undefined = undefined;
  protected _props: P;

  /** Live props. Read-only; write through `set`. */
  get props(): DeepReadonly<P> {
    return this._props as DeepReadonly<P>;
  }

  /** True after `create` until `commit`. `restore` / `parse` start false. */
  get isNew(): boolean {
    return this.#isNew;
  }

  /**
   * True after `create`, `parse`, a writing `set`, or `validate()`.
   * `restore` starts false — the schema has not run.
   */
  get isValidated(): boolean {
    return this.#validated;
  }

  /**
   * Pre-mutation props after the first `set` on a restored entity.
   * `undefined` when same-ref (clean) or `create`d and never `commit`ted.
   */
  get original(): DeepReadonly<P> | undefined {
    if (
      this.#original === undefined ||
      Object.is(this._props, this.#original)
    ) {
      return undefined;
    }
    return this.#original as DeepReadonly<P>;
  }

  protected constructor(props: P) {
    this._props = props;
  }

  /** Copy-on-write mutate. Edit `draft` and return `this`. Re-validates the schema after a write. */
  set(producer: (draft: P) => void): this {
    const previousRoot = this._props;
    const backup = cloneValue(this._props);
    const previousSnapshot = this.#snapshot;
    const wasOwned = this.#owned?.has(this._props) === true;
    const result = applyCowDraft(this._props, this.#owned, producer);
    this._props = result.root;
    this.#owned = result.owned;
    if (result.wrote) {
      this.#snapshot = undefined;
      try {
        this.#assertSchema();
      } catch (error) {
        this._props = wasOwned ? backup : previousRoot;
        this.#owned = wasOwned ? new WeakSet([backup]) : undefined;
        this.#snapshot = previousSnapshot;
        throw error;
      }
      this.#validated = true;
    }
    return this;
  }

  /**
   * Run the schema if it has not already passed on this instance.
   * No-op when `isValidated`. Does not rewrite props (no strip/defaults).
   * Throws `CodedError` `VALIDATION` if the schema rejects current props.
   */
  validate(): this {
    if (this.#validated) return this;
    this.#assertSchema();
    this.#validated = true;
    return this;
  }

  /** Shallow keys that differ from `original`. `{ deep: true }` returns dotted leaf paths. */
  getChangedKeys(): Array<ChangedKey<P>>;
  getChangedKeys(opts: { deep: true }): string[];
  getChangedKeys(opts?: { deep?: boolean }): string[];
  getChangedKeys(opts?: { deep?: boolean }): string[] {
    if (
      !this.#isNew &&
      (this.#original === undefined || Object.is(this._props, this.#original))
    ) {
      return EMPTY_CHANGED_KEYS;
    }

    if (opts?.deep) {
      const out: string[] = [];
      diffDeep(this._props, this.#isNew ? undefined : this.#original, '', out);
      return out.length === 0 ? EMPTY_CHANGED_KEYS : out;
    }

    if (this.#isNew) {
      return Object.keys(this._props);
    }

    const current = this._props;
    const original = this.#original as P;
    const keys = new Set<string>([
      ...Object.keys(current),
      ...Object.keys(original),
    ]);
    const changed: string[] = [];
    for (const key of keys) {
      const k = key as keyof P;
      if (!Object.is(current[k], original[k])) changed.push(key);
    }
    return changed.length === 0 ? EMPTY_CHANGED_KEYS : changed;
  }

  /** True when `create`d and not yet `commit`ted, or any shallow key changed. */
  isDirty(): boolean {
    return this.#isNew || this.getChangedKeys().length > 0;
  }

  /** Accept current props as original; `isNew` becomes false. Adapters after persist; not use-cases. */
  commit(): this {
    this.#original = this._props;
    this.#isNew = false;
    this.#owned = undefined;
    return this;
  }

  /** Deep frozen snapshot for persistence and use-case output. Reused until the next `set`. */
  toProps(): DeepReadonly<P> {
    if (this.#snapshot === undefined) {
      this.#snapshot = frozenSnapshot(this._props);
    }
    return this.#snapshot as DeepReadonly<P>;
  }

  /** JSON serialization is the plain props snapshot. */
  toJSON(): DeepReadonly<P> {
    return this.toProps();
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
   * Validate typed props and construct a new instance (`isNew: true`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static create<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = instantiate(this, props) as Entity<object>;
    instance.#markNew();
    instance.#validated = true;
    return instance as T['prototype'];
  }

  /**
   * Reconstruct an existing instance (`isNew: false`) without running the
   * schema. Props are stored as given (no strip/defaults). `isValidated`
   * starts false until `set` writes or `validate()` runs.
   */
  static restore<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = construct(this, props) as Entity<object>;
    instance.#markRestored();
    return instance as T['prototype'];
  }

  /**
   * Trust boundary for untyped input. Validates like `create`;
   * tracking matches `restore` (`isNew: false`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the value.
   */
  static parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): T['prototype'] {
    const instance = instantiate(this, value) as Entity<object>;
    instance.#markRestored();
    instance.#validated = true;
    return instance as T['prototype'];
  }

  #markNew(): void {
    this._props = { ...this._props };
    this.#original = undefined;
    this.#isNew = true;
    this.#owned = new WeakSet();
    this.#owned.add(this._props);
    this.#snapshot = undefined;
  }

  #markRestored(): void {
    this.#original = this._props;
    this.#isNew = false;
    this.#owned = undefined;
    this.#snapshot = undefined;
  }

  #assertSchema(): void {
    const Ctor = this.constructor as unknown as EntityConstructor;
    const parsed = validate(Ctor.schema, this._props);
    if (!parsed.ok) {
      throw validationError(
        `hexok: ${Ctor.key} validation failed`,
        parsed.issues,
      );
    }
  }
}

/** Subclass constructor shape for `create` / `restore` / `parse`. */
export type EntityConstructor = {
  /** Entity name used in validation and error messages. */
  readonly key: string;
  /** Standard Schema for `create` / `parse` / `set` / `validate()`. Declare on each subclass. */
  readonly schema: StandardSchemaV1;
  /** Declared refusal codes. Keys are the `error()` union. Declare on each subclass. */
  readonly errors: ErrorMap;
  // biome-ignore lint/suspicious/noExplicitAny: Entity is invariant in P; subclasses must still satisfy this
  readonly prototype: Entity<any>;
};

type SchemaOutput<T extends EntityConstructor> = Infer<T['schema']>;

/** `keyof object` is `never`; widen so `Entity<P>` stays assignable to `Entity<object>`. */
type ChangedKey<P extends object> = keyof P extends never
  ? string
  : keyof P & string;

function instantiate<T extends EntityConstructor>(
  Ctor: T,
  value: unknown,
): T['prototype'] {
  const parsed = validate(Ctor.schema, value);
  if (!parsed.ok) {
    throw validationError(
      `hexok: ${Ctor.key} validation failed`,
      parsed.issues,
    );
  }
  return construct(Ctor, parsed.value);
}

function construct<T extends EntityConstructor>(
  Ctor: T,
  value: unknown,
): T['prototype'] {
  const CtorImpl = Ctor as unknown as new (props: unknown) => T['prototype'];
  return new CtorImpl(value);
}

function diffDeep(
  current: unknown,
  original: unknown,
  path: string,
  out: string[],
): void {
  if (Object.is(current, original)) return;

  const currentPlain = isPlainObject(current);
  const originalPlain = isPlainObject(original);

  if (currentPlain || originalPlain) {
    const keys = new Set<string>([
      ...(currentPlain ? Object.keys(current) : []),
      ...(originalPlain ? Object.keys(original) : []),
    ]);
    if (keys.size === 0) {
      if (path) out.push(path);
      return;
    }
    for (const key of keys) {
      const next = path ? `${path}.${key}` : key;
      diffDeep(
        currentPlain ? current[key] : undefined,
        originalPlain ? original[key] : undefined,
        next,
        out,
      );
    }
    return;
  }

  if (path) out.push(path);
}

function throwEntityError(
  ctor: { errors: object; key: string },
  code: string,
  data?: unknown,
): never {
  const def = (ctor.errors as ErrorMap)[code];
  if (def === undefined) {
    throw new Error(`hexok: undeclared error "${code}" on ${ctor.key}`);
  }
  throw new CodedError({
    code,
    message: def.message ?? code,
    ...(data !== undefined ? { data } : {}),
  });
}
