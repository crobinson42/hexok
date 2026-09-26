import { validationError } from './coded-error.js';
import {
  applyCowDraft,
  cloneValue,
  frozenSnapshot,
  isPlainObject,
} from './cow-draft.js';
import {
  type InferSchema,
  type ResolvedSchema,
  type SchemaSource,
  schemaDefinition,
} from './schema.js';
import type { StandardSchemaV1 } from './standard-schema.js';
import { validate } from './validate.js';

const EMPTY_CHANGED_KEYS: string[] = Object.freeze([]) as unknown as string[];

/** Recursively readonly view of entity props. `Date` values stay `Date`. */
export type DeepReadonly<T> = T extends Date
  ? T
  : T extends readonly (infer U)[]
    ? ReadonlyArray<DeepReadonly<U>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

type EntityConstructor = {
  readonly token: string;
  readonly schema: StandardSchemaV1;
  // biome-ignore lint/suspicious/noExplicitAny: props vary per entity
  readonly prototype: EntityBase<any>;
};

type SchemaOutput<T extends EntityConstructor> = InferSchema<T['schema']>;

/** `keyof object` is `never`; widen so an open props type still has string keys. */
type ChangedKey<P extends object> = keyof P extends never
  ? string
  : keyof P & string;

/** Public instance of an entity. Subclass methods stay on `this`. */
export interface EntityInstance<P extends object> {
  readonly props: DeepReadonly<P>;
  readonly isNew: boolean;
  readonly isValidated: boolean;
  readonly original: DeepReadonly<P> | undefined;
  set(producer: (draft: P) => void): this;
  validate(): this;
  getChangedKeys(): Array<ChangedKey<P>>;
  getChangedKeys(opts: { deep: true }): string[];
  getChangedKeys(opts?: { deep?: boolean }): string[];
  isDirty(): boolean;
  commit(): this;
  toProps(): DeepReadonly<P>;
  toJSON(): DeepReadonly<P>;
}

type EntityHandle<Token extends string, S extends SchemaSource> = {
  readonly token: Token;
  readonly schema: ResolvedSchema<S>;
  readonly prototype: EntityInstance<EntityProps<S>>;
  create<T extends { readonly prototype: EntityInstance<EntityProps<S>> }>(
    this: T,
    props: EntityProps<S> | DeepReadonly<EntityProps<S>>,
  ): T['prototype'];
  restore<T extends { readonly prototype: EntityInstance<EntityProps<S>> }>(
    this: T,
    props: EntityProps<S> | DeepReadonly<EntityProps<S>>,
  ): T['prototype'];
  parse<T extends { readonly prototype: EntityInstance<EntityProps<S>> }>(
    this: T,
    value: unknown,
  ): T['prototype'];
} & (abstract new (
  props: EntityProps<S>,
  init: never,
) => EntityInstance<EntityProps<S>>);

/**
 * Mutable aggregate. The token and schema are arguments of {@link Entity},
 * so a subclass cannot forget them. Rules are methods. A refusal throws an
 * {@link Errors} catalog member. Override `set` only when the copy-on-write
 * write path itself must change.
 *
 * ```ts
 * class Incident extends Entity('Incident', incidentSchema) {
 *   close(now: Date): this {
 *     if (this.props.status === 'closed') throw DomainError.AlreadyClosed()
 *     return this.set((draft) => {
 *       draft.status = 'closed'
 *       draft.closedAt = now
 *     })
 *   }
 * }
 * ```
 */
type EntityProps<S extends SchemaSource> =
  InferSchema<S> extends object ? InferSchema<S> : never;

export function Entity<const Token extends string, S extends SchemaSource>(
  token: Token,
  schema: S,
): EntityHandle<Token, S> {
  const definition = schemaDefinition(schema);

  abstract class EntityClass extends EntityBase<EntityProps<S>> {
    /** Entity name. Literal type of the string passed to {@link Entity}. */
    static readonly token: Token = token;
    /** Schema used by `create`, `parse`, `set`, and `validate`. */
    static readonly schema: ResolvedSchema<S> = definition;
    /** Nominal marker. Each `Entity(...)` call is a distinct class. */
    readonly #brand = true;

    protected constructor(props: EntityProps<S>) {
      super(props);
      void this.#brand;
    }
  }

  return EntityClass as unknown as EntityHandle<Token, S>;
}

abstract class EntityBase<P extends object> {
  /** Entity name used in validation messages. */
  static readonly token: string;
  /** Schema for `create` / `parse` / `set` / `validate()`. */
  static readonly schema: StandardSchemaV1;

  #isNew = false;
  #validated = false;
  #original: P | undefined = undefined;
  #owned: WeakSet<object> | undefined = undefined;
  #snapshot: P | undefined = undefined;
  #props: P;

  /** Live props. Read-only; write through `set`. */
  get props(): DeepReadonly<P> {
    return this.#props as DeepReadonly<P>;
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
      Object.is(this.#props, this.#original)
    ) {
      return undefined;
    }
    return this.#original as DeepReadonly<P>;
  }

  protected constructor(props: P) {
    this.#props = props;
  }

  /** Copy-on-write mutate. Edit `draft` and return `this`. Re-validates after a write. */
  set(producer: (draft: P) => void): this {
    const previousRoot = this.#props;
    const backup = cloneValue(this.#props);
    const previousSnapshot = this.#snapshot;
    const wasOwned = this.#owned?.has(this.#props) === true;
    const result = applyCowDraft(this.#props, this.#owned, producer);
    this.#props = result.root;
    this.#owned = result.owned;
    if (result.wrote) {
      this.#snapshot = undefined;
      try {
        this.#assertSchema();
      } catch (error) {
        this.#props = wasOwned ? backup : previousRoot;
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
      (this.#original === undefined || Object.is(this.#props, this.#original))
    ) {
      return EMPTY_CHANGED_KEYS;
    }

    if (opts?.deep) {
      const out: string[] = [];
      diffDeep(this.#props, this.#isNew ? undefined : this.#original, '', out);
      return out.length === 0 ? EMPTY_CHANGED_KEYS : out;
    }

    if (this.#isNew) {
      return Object.keys(this.#props);
    }

    const current = this.#props;
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

  /** Accept current props as original; `isNew` becomes false. */
  commit(): this {
    this.#original = this.#props;
    this.#isNew = false;
    this.#owned = undefined;
    return this;
  }

  /** Deep frozen snapshot for persistence and use-case output. Reused until the next `set`. */
  toProps(): DeepReadonly<P> {
    if (this.#snapshot === undefined) {
      this.#snapshot = frozenSnapshot(this.#props);
    }
    return this.#snapshot as DeepReadonly<P>;
  }

  /** JSON serialization is the plain props snapshot. */
  toJSON(): DeepReadonly<P> {
    return this.toProps();
  }

  /**
   * Validate typed props and construct a new instance (`isNew: true`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static create<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = instantiate(this, props) as EntityBase<object>;
    instance.#markNew();
    instance.#validated = true;
    return instance as T['prototype'];
  }

  /**
   * Reconstruct an existing instance (`isNew: false`) without running the
   * schema. Props are stored as given. `isValidated` starts false until
   * `set` writes or `validate()` runs.
   */
  static restore<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = construct(this, props) as EntityBase<object>;
    instance.#markRestored();
    return instance as T['prototype'];
  }

  /**
   * Trust boundary for untyped input. Validates like `create`.
   * Tracking matches `restore` (`isNew: false`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the value.
   */
  static parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): T['prototype'] {
    const instance = instantiate(this, value) as EntityBase<object>;
    instance.#markRestored();
    instance.#validated = true;
    return instance as T['prototype'];
  }

  #markNew(): void {
    this.#props = { ...this.#props };
    this.#original = undefined;
    this.#isNew = true;
    this.#owned = new WeakSet();
    this.#owned.add(this.#props);
    this.#snapshot = undefined;
  }

  #markRestored(): void {
    this.#original = this.#props;
    this.#isNew = false;
    this.#owned = undefined;
    this.#snapshot = undefined;
  }

  #assertSchema(): void {
    const ctor = this.constructor as unknown as EntityConstructor;
    const parsed = validate(ctor.schema, this.#props);
    if (!parsed.ok) {
      throw validationError(
        `hexok: ${ctor.token} validation failed`,
        parsed.issues,
      );
    }
  }
}

function instantiate<T extends EntityConstructor>(
  Ctor: T,
  value: unknown,
): T['prototype'] {
  const parsed = validate(Ctor.schema, value);
  if (!parsed.ok) {
    throw validationError(
      `hexok: ${Ctor.token} validation failed`,
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
