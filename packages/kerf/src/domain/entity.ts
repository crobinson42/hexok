import {
  CodedError,
  type ErrorMap,
  type Infer,
  type StandardSchemaV1,
  validate,
} from '../core/index.js';
import { applyCowDraft, frozenSnapshot, isPlainObject } from './cow-draft.js';

const EMPTY_CHANGED_KEYS: string[] = Object.freeze([]) as unknown as string[];

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
 * Check invariants before `set`.
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
  static readonly key: string;
  #isNew = false;
  #original: P | undefined = undefined;
  #owned: WeakSet<object> | undefined = undefined;
  #snapshot: P | undefined = undefined;
  protected _props: P;

  /** Live schema output. Read-only; write through `set`. */
  get props(): DeepReadonly<P> {
    return this._props as DeepReadonly<P>;
  }

  get isNew(): boolean {
    return this.#isNew;
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

  set(producer: (draft: P) => void): this {
    const result = applyCowDraft(this._props, this.#owned, producer);
    this._props = result.root;
    this.#owned = result.owned;
    if (result.wrote) this.#snapshot = undefined;
    return this;
  }

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
   * Validate typed props and construct a new instance (`isNew: true`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static create<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = instantiate(this, props) as Entity<object>;
    instance.#markNew();
    return instance as T['prototype'];
  }

  /**
   * Validate typed props and reconstruct an existing instance (`isNew: false`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static restore<T extends EntityConstructor>(
    this: T,
    props: SchemaOutput<T> | DeepReadonly<SchemaOutput<T>>,
  ): T['prototype'] {
    const instance = instantiate(this, props) as Entity<object>;
    instance.#markRestored();
    return instance as T['prototype'];
  }

  /**
   * Trust boundary for untyped input. Same validation as create/restore;
   * tracking matches restore (`isNew: false`).
   * Throws `CodedError` `VALIDATION` if the schema rejects the value.
   */
  static parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): T['prototype'] {
    const instance = instantiate(this, value) as Entity<object>;
    instance.#markRestored();
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
}

export type EntityConstructor = {
  readonly key: string;
  readonly schema: StandardSchemaV1;
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
    throw new CodedError({
      code: 'VALIDATION',
      message: `kerf: ${Ctor.key} validation failed`,
    });
  }
  const CtorImpl = Ctor as unknown as new (props: unknown) => T['prototype'];
  return new CtorImpl(parsed.value);
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
    throw new Error(`kerf: undeclared error "${code}" on ${ctor.key}`);
  }
  throw new CodedError({
    code,
    message: def.message ?? code,
    ...(data !== undefined ? { data } : {}),
  });
}
