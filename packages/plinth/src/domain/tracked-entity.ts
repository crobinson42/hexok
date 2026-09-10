import type { Infer } from '../core/index.js';
import { Entity, type EntityConstructor, instantiate } from './entity.js';

/**
 * Opt-in dirty tracking. Methods **mutate this** and return `this`.
 * Nested writes dirty the parent key (`address`, not `address.city`).
 *
 * ```ts
 * class Site extends TrackedEntity<SiteProps> {
 *   relocate(city: string, region: string): this {
 *     if (this.address.city === city) this.error('SAME_ADDRESS')
 *     this.set('address', { ...this.address, city, region })
 *     return this
 *   }
 * }
 * ```
 */
export abstract class TrackedEntity<P extends object> extends Entity<P> {
  #isNew = false;
  #original: P | undefined;

  protected constructor(props: P) {
    super({ ...props });
    this.#isNew = false;
    this.#original = { ...props };
  }

  get isNew(): boolean {
    return this.#isNew;
  }

  /** Restore snapshot. `undefined` when the entity was `create`d and never `commit`ted. */
  get original(): P | undefined {
    return this.#original;
  }

  /**
   * Tracked aggregates mutate via `set`. Calling `with` is a type error.
   */
  // @ts-expect-error poison the call; not a legal override of Entity.with(Partial)
  override with(
    ..._args: [`plinth: TrackedEntity is mutable; use set()`]
  ): never {
    throw new Error('plinth: TrackedEntity is mutable; use set()');
  }

  set<K extends keyof P>(key: K, value: P[K]): this;
  set(partial: Partial<P>): this;
  set(keyOrPartial: keyof P | Partial<P>, value?: P[keyof P]): this {
    if (isPartial(keyOrPartial)) {
      this._props = { ...this._props, ...keyOrPartial };
      return this;
    }
    this._props = { ...this._props, [keyOrPartial]: value as P[keyof P] };
    return this;
  }

  /**
   * Top-level keys whose values are not `Object.is` equal to the restore snapshot.
   * A new entity reports every current key.
   */
  getChangedKeys(): Array<keyof P & string> {
    const current = this._props;
    if (this.#original === undefined) {
      return Object.keys(current) as Array<keyof P & string>;
    }
    const keys = new Set<string>([
      ...Object.keys(current),
      ...Object.keys(this.#original),
    ]);
    const changed: Array<keyof P & string> = [];
    for (const key of keys) {
      const k = key as keyof P;
      if (!Object.is(current[k], this.#original[k])) {
        changed.push(key as keyof P & string);
      }
    }
    return changed;
  }

  isDirty(): boolean {
    return this.#isNew || this.getChangedKeys().length > 0;
  }

  /** Accept current props as the new original snapshot; `isNew` becomes false. */
  commit(): this {
    this.#original = { ...this._props };
    this.#isNew = false;
    return this;
  }

  override toProps(): P {
    return { ...this._props };
  }

  override toJSON(): P {
    return this.toProps();
  }

  private markNew(): void {
    this.#isNew = true;
    this.#original = undefined;
  }

  /**
   * Validate and construct a **new** tracked instance (`isNew: true`, no original).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static override create<T extends EntityConstructor>(
    this: T,
    props: Infer<T['schema']>,
  ): T['prototype'] {
    const instance = instantiate(this, props);
    const tracked = instance as TrackedEntity<object>;
    tracked.markNew();
    return instance;
  }

  /**
   * Validate and reconstruct from persistence (`isNew: false`, original snapshot).
   * Throws `CodedError` `VALIDATION` if the schema rejects the props.
   */
  static override restore<T extends EntityConstructor>(
    this: T,
    props: Infer<T['schema']>,
  ): T['prototype'] {
    return instantiate(this, props);
  }

  static override parse<T extends EntityConstructor>(
    this: T,
    value: unknown,
  ): T['prototype'] {
    return instantiate(this, value);
  }
}

function isPartial<P>(value: keyof P | Partial<P>): value is Partial<P> {
  return typeof value === 'object' && value !== null;
}
